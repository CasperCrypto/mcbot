import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { HermesInfo } from "../src/contracts/api";
import { diagnosticsText, HIDDEN, osLine, redact, tail } from "./diagnostics";

const hermes = (over: Partial<HermesInfo> = {}): HermesInfo => ({
  kind: "bundled", path: "/x/hermes", upstream: { url: "u", commit: "1e208b280deb1234", date: "2026-11-01" }, root: "/x/root",
  managedRoot: true, gateway: { running: true, pid: 7 }, source: true, installed: true, setup: { state: "done", lines: [] }, ...over,
});

describe("redact", () => {
  it("hides saved keys, longest first, and the home folder", () => {
    const text = "key=abcdef123456 long=abcdef123456XYZ path=/Users/maya/McBot/hermes";
    const out = redact(text, ["abcdef123456", "abcdef123456XYZ", "abc"], "/Users/maya");
    expect(out).toBe(`key=${HIDDEN} long=${HIDDEN} path=~/McBot/hermes`);
  });

  it("hides token-shaped strings that are not saved keys", () => {
    const out = redact(
      [
        "using sk-or-v1-0123456789abcdef0123",
        "telegram 1234567890:AAH9xYzAbCdEfGhIjKlMnOpQrStUvWxYz012",
        "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload",
        "OPENROUTER_API_KEY=supersecretvalue",
        '"bot_token": "abcdefgh12345"',
      ].join("\n"),
      [],
      "/home/nobody",
    );
    expect(out).not.toMatch(/0123456789abcdef|AAH9xYz|eyJhbGci|supersecretvalue|abcdefgh12345/);
    expect(out).toContain(`Bearer ${HIDDEN}`);
    expect(out).toContain(`OPENROUTER_API_KEY=${HIDDEN}`);
  });

  it("leaves ordinary log lines alone", () => {
    const line = "McBot engine http://127.0.0.1:4317 · run 2026-11-11T09:00 succeeded in 1.2 s";
    expect(redact(line, [], "/home/nobody")).toBe(line);
  });
});

describe("tail", () => {
  it("returns the last whole lines of a file, or null without one", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mcbot-diag-"));
    const file = join(dir, "engine.log");
    writeFileSync(file, Array.from({ length: 500 }, (_, i) => `line ${i}`).join("\n") + "\n");
    const last = await tail(file, 48_000, 3);
    expect(last).toBe("line 497\nline 498\nline 499");
    const cut = await tail(file, 30, 200);
    expect(cut!.split("\n").every((l) => /^line \d+$/.test(l))).toBe(true);
    expect(await tail(join(dir, "missing.log"))).toBeNull();
  });
});

describe("diagnosticsText", () => {
  const at = new Date("2026-11-11T09:00:00Z");

  it("says what McBot and its engine are doing", () => {
    const text = diagnosticsText({ version: "0.1.0", os: osLine("darwin", "24.1.0", "arm64"), installed: true, hermes: hermes(), boards: 2, log: "started\nran", at });
    expect(text).toBe(
      [
        "McBot 0.1.0 · installed app",
        "System: macOS (darwin 24.1.0, arm64)",
        "Engine: built in, prepared, gateway running",
        "Engine base: 1e208b280deb (2026-11-01)",
        "Boards: 2",
        "Time: 2026-11-11T09:00:00.000Z",
        "",
        "Engine log, last lines:",
        "started",
        "ran",
        "",
      ].join("\n"),
    );
  });

  it("shows a failed first-launch preparation and a missing log", () => {
    const failed = hermes({ kind: null, path: null, gateway: { running: false, pid: null }, setup: { state: "failed", lines: ["a", "b", "uv: network unreachable"] } });
    const text = diagnosticsText({ version: "0.1.0", os: "Linux", installed: false, hermes: failed, boards: 1, log: null, at });
    expect(text).toContain("Engine: built in, preparing failed: a / b / uv: network unreachable");
    expect(text).toContain("No engine log: in development the engine logs to its terminal.");
  });
});

describe("GET /api/diagnostics", () => {
  it("reports the engine and its log, with saved keys and the home folder hidden", async () => {
    const { startEngine } = await import("./server");
    const workspace = mkdtempSync(join(tmpdir(), "mcbot-diag-engine-"));
    const logFile = join(workspace, "engine.log");
    const engine = await startEngine({ workspace, hermesHome: join(workspace, "hermes"), managedRoot: true, port: 0, host: "127.0.0.1", allowedOrigins: ["http://localhost:5173"], logFile });
    try {
      await engine.relay.create("main", "Main");
      const headers = { origin: "http://localhost:5173", "content-type": "application/json" };
      const saved = await fetch(`${engine.url}/api/secrets`, { method: "POST", headers, body: JSON.stringify({ name: "CLOUD_KEY", value: "ck-live-9f8e7d6c5b4a" }) });
      expect(saved.status).toBe(200);
      writeFileSync(logFile, "McBot engine started\nrequest with ck-live-9f8e7d6c5b4a failed: 401\n");
      const res = await fetch(`${engine.url}/api/diagnostics`, { headers });
      const { text } = (await res.json()) as { text: string };
      expect(res.status).toBe(200);
      expect(text).toMatch(/^McBot 0\.1\.0 · /);
      expect(text).toContain("Boards: 1");
      expect(text).toContain(`request with ${HIDDEN} failed: 401`);
      expect(text).not.toContain("ck-live-9f8e7d6c5b4a");
    } finally {
      await engine.close();
    }
  });
});
