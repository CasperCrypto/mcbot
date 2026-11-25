/**
 * Documents for the agents (Knowledge → Business). The original goes into the shared files folder
 * (`<workspace>/files/knowledge/`, never over an existing file) and its text onto the board, where
 * compile makes it every agent's `business-files` skill (src/compile/docs.ts). Text files are read as
 * they are; PDF and Office files are converted by McBot's own Hermes with the extractor its read_file
 * tool uses (tools/read_extract.py `extract_document_text`), so agents read the same text Hermes would.
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { DOC_TEXT_MAX } from "../src/contracts/graph";

/** The largest original McBot keeps (Hermes' own extractor stops at 50 MB). */
export const DOC_MAX_BYTES = 30 * 1024 * 1024;

const TEXT = new Set([".md", ".markdown", ".txt", ".text", ".csv", ".tsv", ".json", ".yaml", ".yml", ".html", ".htm", ".xml", ".log", ".ini", ".toml", ".rst", ".org", ".tex"]);
/** What Hermes' extractor reads (tools/read_extract.py EXTRACTABLE_EXTENSIONS and ANYDOC_EXTENSIONS). */
const DOCUMENT = new Set([".pdf", ".docx", ".docm", ".doc", ".xlsx", ".xlsm", ".xlsb", ".xls", ".pptx", ".pptm", ".ppt", ".pps", ".ppsx", ".odt", ".ods", ".odp", ".rtf", ".epub", ".ipynb"]);

export type DocKind = "text" | "document";

/** How McBot reads a file, by its extension; null = not a document it can read. */
export function docKind(name: string): DocKind | null {
  const ext = extname(name).toLowerCase();
  return TEXT.has(ext) ? "text" : DOCUMENT.has(ext) ? "document" : null;
}

/** A name safe to save: no folders, no control characters, never empty. */
export function safeDocName(name: string): string {
  const base = basename(name.replace(/\\/g, "/")).replace(/[\u0000-\u001f<>:"|?*]/g, "").trim().replace(/^\.+/, "");
  return base.slice(0, 200) || "document.txt";
}

/** `dir/name`, or `dir/name (2).ext`… when that file exists: an earlier document is never replaced. */
export function freePath(dir: string, name: string, exists: (p: string) => boolean = existsSync): string {
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let p = join(dir, name);
  for (let n = 2; exists(p); n++) p = join(dir, `${stem} (${n})${ext}`);
  return p;
}

/** Text as the board keeps it: no BOM, LF, at most DOC_TEXT_MAX characters. */
export function docText(raw: string): { text: string; truncated: boolean } {
  const text = raw.replace(/^﻿/, "").replace(/\r\n?/g, "\n").replace(/\u0000/g, "");
  return text.length > DOC_TEXT_MAX ? { text: text.slice(0, DOC_TEXT_MAX), truncated: true } : { text, truncated: false };
}

/** Saves the original and returns where it went. */
export async function saveDoc(dir: string, name: string, data: Uint8Array): Promise<string> {
  await mkdir(dir, { recursive: true });
  const path = freePath(dir, safeDocName(name));
  await writeFile(path, data, { flag: "wx" });
  return path;
}

const EXTRACT = [
  "import json, sys",
  "from tools.read_extract import extract_document_text",
  "try:",
  "    sys.stdout.write(json.dumps({'text': extract_document_text(sys.argv[1])}))",
  "except Exception as exc:",
  "    sys.stdout.write(json.dumps({'error': f'{type(exc).__name__}: {exc}'}))",
].join("\n");

/**
 * A document's text through Hermes' own extractor: `python -c` in the prepared Hermes environment, run
 * from Hermes' folder so its modules import (the same Python and packages read_file uses).
 */
export function extractWithHermes(python: string, hermesDir: string, env: NodeJS.ProcessEnv, path: string, timeoutMs = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(python, ["-c", EXTRACT, path], { cwd: hermesDir, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", () => {
      clearTimeout(timer);
      const line = out.trim().split("\n").at(-1) ?? "";
      try {
        const r = JSON.parse(line) as { text?: string; error?: string };
        if (typeof r.text === "string") return resolve(r.text);
        reject(new Error(r.error ?? "Hermes could not read the document"));
      } catch {
        reject(new Error(err.trim().split("\n").at(-1) || "Hermes could not read the document"));
      }
    });
  });
}

/** Hermes' folder from the bundled launcher (`<hermes>/hermes`, the first of HermesBinary.prefix). */
export const hermesDirOf = (launcher: string) => dirname(launcher);
