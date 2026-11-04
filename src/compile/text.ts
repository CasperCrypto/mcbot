import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

const encoder = new TextEncoder();

/**
 * Canonical text for every compiled file: LF line endings, no trailing
 * whitespace on lines, no BOM, exactly one trailing newline.
 */
export function canonicalText(input: string): string {
  const lf = input.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const lines = lf.split("\n").map((line) => line.replace(/[ \t]+$/, ""));
  const body = lines.join("\n").replace(/\n+$/, "");
  return `${body}\n`;
}

export function utf8Bytes(text: string): Uint8Array {
  return encoder.encode(text);
}

export function sha256Hex(text: string): string {
  return bytesToHex(sha256(utf8Bytes(text)));
}
