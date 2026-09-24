/**
 * AGENT-006 — the baseline target server's argument surface and its labelling.
 *
 * Blueprint §18's `target:vanilla` is accepted so the documented command runs. What
 * this suite pins down is that accepting the word never means adopting it: the
 * correction is printed, and no result or manifest ever carries the spelling.
 */
import { describe, it, expect } from "vitest";
import { parseServeArgs, counterLine } from "../src/serve.js";
import { VANILLA_CORRECTION, FIXTURE_LABEL, FIXTURE_ID } from "../src/fixture-label.js";
import { fileURLToPath, pathToFileURL } from "node:url";

describe("target names", () => {
  it("defaults to the fixture", () => {
    expect(parseServeArgs([])).toMatchObject({ port: 4021, correctedFromVanilla: false });
  });

  it("accepts the blueprint's spelling and flags it for correction", () => {
    expect(parseServeArgs(["--target", "vanilla"]).correctedFromVanilla).toBe(true);
  });

  it("refuses anything else rather than guessing", () => {
    expect(() => parseServeArgs(["--target", "upstream"])).toThrow(/unknown target: upstream/);
  });
});

describe("the correction", () => {
  it("denies the three things the word would imply", () => {
    expect(VANILLA_CORRECTION).toContain("Nothing upstream is running here");
    expect(VANILLA_CORRECTION).toContain("@x402/*");
    expect(VANILLA_CORRECTION).toContain("API-009");
  });

  it("lives beside the label, so the claims audit has one place to look", () => {
    expect(FIXTURE_LABEL).toContain("NOT upstream x402");
    expect(FIXTURE_ID).toBe("vulnerable-fixture-v1");
  });
});

describe("the counter line", () => {
  it("shows grants against settlements, which is the shape of the published A2 result", () => {
    expect(counterLine("FIXTURE", 50, 1)).toContain("grants:  50  |  settlements:   1");
  });

  it("keeps a fixed width so the numbers do not jitter on screen", () => {
    expect(counterLine("FIXTURE", 1, 1).length).toBe(counterLine("FIXTURE", 999, 999).length);
  });
});

describe("the entry-point guard", () => {
  // This repository lives under "8th Sem". `file://${process.argv[1]}` leaves the
  // space alone while `import.meta.url` percent-encodes it, so the naive compare is
  // false here and `main()` never runs: the server started, printed nothing and
  // served nothing. The round-trip through `pathToFileURL` is what fixes it.
  it("round-trips a path containing a space, where string concatenation does not", () => {
    const here = fileURLToPath(import.meta.url);
    expect(pathToFileURL(here).href).toBe(import.meta.url);
    if (here.includes(" ")) expect(`file://${here}`).not.toBe(import.meta.url);
  });
});
