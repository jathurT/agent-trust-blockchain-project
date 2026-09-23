import { describe, expect, it } from "vitest";
import { AmountError, atomicFromWire, atomicToWire, formatAtomic, parseAtomic } from "../src/amounts.js";

const USDC = 6;

describe("parseAtomic", () => {
  it("parses whole and fractional amounts", () => {
    expect(parseAtomic("0.25", USDC)).toBe(250_000n);
    expect(parseAtomic("1", USDC)).toBe(1_000_000n);
    expect(parseAtomic("0.000001", USDC)).toBe(1n);
    expect(parseAtomic("1234.5", USDC)).toBe(1_234_500_000n);
  });

  it("keeps precision a float would lose", () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point; in atomic units it is exact.
    expect(parseAtomic("0.1", USDC) + parseAtomic("0.2", USDC)).toBe(parseAtomic("0.3", USDC));
  });

  it("refuses to round rather than silently truncating", () => {
    expect(() => parseAtomic("0.0000001", USDC)).toThrow(AmountError);
  });

  it("rejects anything that is not a decimal number", () => {
    for (const bad of ["", "1e6", "0x10", "1,000", "abc", "1.2.3", " 1 2 "]) {
      expect(() => parseAtomic(bad, USDC), bad).toThrow(AmountError);
    }
  });

  it("handles a zero-decimal token", () => {
    expect(parseAtomic("7", 0)).toBe(7n);
    expect(() => parseAtomic("7.1", 0)).toThrow(AmountError);
  });
});

describe("formatAtomic", () => {
  it("round-trips through parseAtomic", () => {
    for (const d of ["0.25", "1.000000", "0.000001", "123456.789012"]) {
      expect(formatAtomic(parseAtomic(d, USDC), USDC)).toBe(Number(d).toFixed(USDC));
    }
  });

  it("pads amounts smaller than one unit", () => {
    expect(formatAtomic(1n, USDC)).toBe("0.000001");
    expect(formatAtomic(0n, USDC)).toBe("0.000000");
  });
});

describe("wire encoding", () => {
  it("treats wire amounts as atomic units, not decimals", () => {
    // The trap this exists to stop: "250000" on the wire is 0.25 USDC, not 250,000.
    expect(atomicFromWire("250000")).toBe(250_000n);
    expect(atomicToWire(250_000n)).toBe("250000");
  });

  it("rejects a decimal point on the wire", () => {
    expect(() => atomicFromWire("0.25")).toThrow(AmountError);
  });

  it("survives amounts beyond Number.MAX_SAFE_INTEGER", () => {
    const huge = "9007199254740993"; // 2^53 + 1
    expect(atomicFromWire(huge).toString()).toBe(huge);
  });
});
