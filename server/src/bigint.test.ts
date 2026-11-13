import { describe, it, expect } from "vitest";
import { serializeBigInts } from "./bigint";

describe("serializeBigInts", () => {
  it("converts a top-level bigint to a string", () => {
    expect(serializeBigInts(12n)).toBe("12");
  });

  it("converts nested bigints in objects and arrays", () => {
    const input = {
      tracks: [
        { id: 1, sizeBytes: 12_345_678n },
        { id: 2, sizeBytes: 9_000_000n },
      ],
      elsewhere: { deep: [{ deeper: 1n }] },
    };
    const result = serializeBigInts(input);
    expect(result.tracks[0].sizeBytes).toBe("12345678");
    expect(result.tracks[1].sizeBytes).toBe("9000000");
    expect(result.elsewhere.deep[0].deeper).toBe("1");
  });

  it("leaves numbers, strings, booleans and null untouched", () => {
    const input = { n: 42, s: "x", b: true, nil: null, f: 1.5 };
    expect(serializeBigInts(input)).toEqual(input);
  });

  it("does not crash on Date or Buffer leaves", () => {
    const date = new Date("2026-11-13T00:00:00Z");
    const input = { when: date, raw: Buffer.from([1, 2, 3]) };
    const result = serializeBigInts(input);
    expect(result.when).toBe(date);
  });

  it("above 2^53, distinct bigints stay distinct as strings", () => {
    const a = 9_007_199_254_740_991n;
    const b = 9_007_199_254_740_993n;
    expect(serializeBigInts(a)).not.toBe(serializeBigInts(b));
  });
});
