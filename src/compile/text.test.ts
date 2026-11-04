import { describe, expect, it } from "vitest";
import { canonicalText, sha256Hex, utf8Bytes } from "./text";

describe("canonicalText", () => {
  it("normalizes line endings, trailing whitespace, BOM and the final newline to exact bytes", () => {
    expect(canonicalText("﻿a  \r\nb\t\rc\n\n\n")).toBe("a\nb\nc\n");
    expect(canonicalText("")).toBe("\n");
    expect(canonicalText("x")).toBe("x\n");
    expect(canonicalText("  indented\n")).toBe("  indented\n");
  });
});

describe("sha256Hex / utf8Bytes", () => {
  it("hashes the UTF-8 bytes (FIPS 180-2 test vector)", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("counts bytes, not code units", () => {
    expect(Array.from(utf8Bytes("é✓"))).toEqual([0xc3, 0xa9, 0xe2, 0x9c, 0x93]);
  });
});
