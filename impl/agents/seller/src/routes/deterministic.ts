/**
 * API-001 — the paid handlers.
 *
 * Everything here is a pure function of the request body. No randomness, no clock, no
 * network, no model, no iteration order that depends on a hash seed. That is not a
 * simplification for the demo: the validator recomputes these outputs independently in
 * Python (VAL-003) and attests to whether they match, so any non-determinism would make
 * an honest seller's work unattestable (DF-08).
 *
 * The transforms are documented here rather than only in code, because the Python side
 * is written from this description, not ported from it.
 */

export interface SummariseRequest {
  text: string;
  sentences?: number;
}

export interface ClassifyRequest {
  text: string;
  labels?: string[];
}

export class BadRequest extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadRequest";
  }
}

/**
 * Split on sentence terminators, keeping the terminator. Deliberately simple and
 * spelled out: the Python implementation must produce the same split for the same
 * bytes, so "use a sentence tokeniser" would not be a specification.
 *
 * A sentence ends at `.`, `!` or `?` followed by whitespace or end-of-input.
 */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c !== "." && c !== "!" && c !== "?") continue;
    const next = text[i + 1];
    if (next === undefined || /\s/.test(next)) {
      const sentence = text.slice(start, i + 1).trim();
      if (sentence.length > 0) out.push(sentence);
      start = i + 1;
    }
  }
  const tail = text.slice(start).trim();
  if (tail.length > 0) out.push(tail);
  return out;
}

/** Lowercase, split on anything that is not a letter or digit, drop empties. */
export function tokenise(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/u).filter((t) => t.length > 0);
}

/**
 * Extractive summary: score each sentence by the sum of its token frequencies over the
 * whole text, divided by its token count, then return the top `n` **in their original
 * order**. Ties break towards the earlier sentence, so the result never depends on sort
 * stability.
 */
export function summarise(request: SummariseRequest): { summary: string; sentences: number; tokens: number } {
  if (typeof request.text !== "string") throw new BadRequest("text must be a string");
  const n = request.sentences ?? 2;
  if (!Number.isInteger(n) || n < 1 || n > 20) throw new BadRequest("sentences must be an integer in 1..20");

  const sentences = splitSentences(request.text);
  const allTokens = tokenise(request.text);
  const frequency = new Map<string, number>();
  for (const token of allTokens) frequency.set(token, (frequency.get(token) ?? 0) + 1);

  const scored = sentences.map((sentence, index) => {
    const tokens = tokenise(sentence);
    const total = tokens.reduce((sum, t) => sum + (frequency.get(t) ?? 0), 0);
    // Integer arithmetic only: a float score would make the ordering depend on the
    // platform's rounding, and the Python side would have to match it exactly.
    return { index, sentence, score: tokens.length === 0 ? 0 : Math.floor((total * 1000) / tokens.length) };
  });

  const chosen = [...scored]
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))
    .slice(0, n)
    .sort((a, b) => a.index - b.index);

  return {
    summary: chosen.map((c) => c.sentence).join(" "),
    sentences: sentences.length,
    tokens: allTokens.length,
  };
}

export const DEFAULT_LABELS = ["payments", "security", "agents", "other"] as const;

/**
 * Keyword classification: count how many tokens of the text appear in each label's
 * keyword set, and return the highest-scoring label. Ties break by the label's position
 * in the list, so the answer never depends on object key order.
 */
const KEYWORDS: Record<string, readonly string[]> = {
  payments: ["payment", "pay", "escrow", "settle", "settlement", "invoice", "usdc", "token", "price"],
  security: ["attack", "replay", "sybil", "exploit", "vulnerability", "signature", "authenticate", "reorg"],
  agents: ["agent", "autonomous", "buyer", "seller", "validator", "registry", "reputation"],
};

export function classify(request: ClassifyRequest): {
  label: string;
  scores: Record<string, number>;
  tokens: number;
} {
  if (typeof request.text !== "string") throw new BadRequest("text must be a string");
  const labels = request.labels ?? [...DEFAULT_LABELS];
  if (!Array.isArray(labels) || labels.length === 0) throw new BadRequest("labels must be a non-empty array");
  if (labels.some((l) => typeof l !== "string")) throw new BadRequest("labels must be strings");

  const tokens = tokenise(request.text);
  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);

  const scores: Record<string, number> = {};
  for (const label of labels) {
    const keywords = KEYWORDS[label] ?? [];
    scores[label] = keywords.reduce((sum, k) => sum + (counts.get(k) ?? 0), 0);
  }

  let best = labels[0] as string;
  let bestScore = scores[best] ?? 0;
  for (const label of labels) {
    const score = scores[label] ?? 0;
    if (score > bestScore) {
      best = label;
      bestScore = score;
    }
  }
  return { label: best, scores, tokens: tokens.length };
}

/**
 * The exact bytes a paid route returns. Serialised here, once, with sorted keys, so the
 * response is byte-stable regardless of how the object was built — and so the validator
 * hashes the same bytes the buyer received.
 */
export function serialise(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value, sortedReplacer), "utf8");
}

function sortedReplacer(_key: string, value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(entries);
}
