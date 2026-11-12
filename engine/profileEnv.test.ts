import { mkdtempSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveGraph } from "../src/compile";
import { Folders } from "./folders";
import { ENV_BEGIN, ENV_END, envEntriesFor, hasLiveChannel, resolveEntries, withKeys, writeProfileKeys } from "./profileEnv";

describe("withKeys", () => {
  it("adds McBot's block after the lines someone wrote with Hermes, and keeps those lines", () => {
    expect(withKeys("# mine\nTELEGRAM_BOT_TOKEN=abc\n", { OPENROUTER_API_KEY: "sk-or-1" })).toBe(
      `# mine\nTELEGRAM_BOT_TOKEN=abc\n\n${ENV_BEGIN}\nOPENROUTER_API_KEY="sk-or-1"\n${ENV_END}\n`,
    );
  });
  it("replaces the block instead of adding a second one, and drops names no longer used", () => {
    const once = withKeys("A=1\n", { FAL_KEY: "f1", OPENAI_API_KEY: "o1" });
    expect(withKeys(once, { OPENAI_API_KEY: "o2" })).toBe(`A=1\n\n${ENV_BEGIN}\nOPENAI_API_KEY="o2"\n${ENV_END}\n`);
  });
  it("removes the block when the agent needs no keys", () => {
    expect(withKeys(withKeys("A=1\n", { FAL_KEY: "f" }), {})).toBe("A=1\n");
    expect(withKeys(withKeys("", { FAL_KEY: "f" }), {})).toBe("");
  });
  it("quotes values the way Hermes reads them back", () => {
    expect(withKeys("", { K: 'a"b\\c #d' })).toContain('K="a\\"b\\\\c #d"\n');
  });
});

describe("envEntriesFor", () => {
  const g = JSON.parse(readFileSync(join(import.meta.dirname, "../test/fixtures/full.graph.json"), "utf8"));
  const { bundles } = resolveGraph(g);
  const researcher = bundles.find((b) => b.agent.data.name === "researcher")!;

  it("names model keys, maker keys, ${env:NAME} in MCP servers and the bot's token and allowed users", () => {
    expect(envEntriesFor(researcher)).toEqual([
      { name: "EXAMPLE_API_KEY", secret: "EXAMPLE_API_KEY" },
      { name: "FAL_KEY", secret: "FAL_KEY" },
      { name: "SEARCH_TOKEN", secret: "SEARCH_TOKEN" },
      { name: "TELEGRAM_ALLOWED_USERS", value: "111,222", with: "TELEGRAM_BOT_TOKEN" },
      { name: "TELEGRAM_BOT_TOKEN", secret: "MCBOT_TELEGRAM_DESK_TOKEN" },
    ]);
  });

  it("writes only saved keys, under the platform's name, and allowed users only with their bot's token", () => {
    const entries = envEntriesFor(researcher);
    expect(resolveEntries(entries, { FAL_KEY: "f" })).toEqual({ FAL_KEY: "f" });
    expect(resolveEntries(entries, { MCBOT_TELEGRAM_DESK_TOKEN: "123:abc" })).toEqual({ TELEGRAM_BOT_TOKEN: "123:abc", TELEGRAM_ALLOWED_USERS: "111,222" });
    expect(hasLiveChannel(researcher, {})).toBe(false);
    expect(hasLiveChannel(researcher, { MCBOT_TELEGRAM_DESK_TOKEN: "123:abc" })).toBe(true);
  });
});

describe("every chat app Hermes ships", () => {
  const agent = { id: "a", kind: "agent", position: { x: 0, y: 0 }, data: { name: "desk" } };
  const model = { id: "m", kind: "model", position: { x: 0, y: 0 }, data: { name: "local", endpoint: "local", baseUrl: "http://127.0.0.1:11434/v1", model: "qwen3:8b" } };
  const board = (chat: Record<string, unknown>) => resolveGraph({
    schema: "mcbot.graph/v1", id: "b", name: "b",
    nodes: [agent, model, { id: "c", kind: "channel", position: { x: 0, y: 0 }, data: { name: "team-chat", ...chat } }],
    edges: [{ id: "e1", source: "a", target: "m" }, { id: "e2", source: "a", target: "c" }],
  }).bundles[0]!;

  it("writes Slack's two tokens under its own variables, saved under the bot's names, with who may message it", () => {
    const slack = board({ platform: "slack", allowedUsers: ["U012AB3CD"] });
    const saved = { MCBOT_TEAM_CHAT_SLACK_BOT_TOKEN: "xoxb-1", MCBOT_TEAM_CHAT_SLACK_APP_TOKEN: "xapp-1" };
    expect(resolveEntries(envEntriesFor(slack), saved)).toEqual({ SLACK_BOT_TOKEN: "xoxb-1", SLACK_APP_TOKEN: "xapp-1", SLACK_ALLOWED_USERS: "U012AB3CD" });
    expect(hasLiveChannel(slack, { MCBOT_TEAM_CHAT_SLACK_BOT_TOKEN: "xoxb-1" })).toBe(false);
    expect(hasLiveChannel(slack, saved)).toBe(true);
  });

  it("writes an app's plain settings from the board (IRC has no secret at all)", () => {
    const irc = board({ platform: "irc", settings: { IRC_SERVER: "irc.libera.chat", IRC_CHANNEL: "#ops", IRC_NICKNAME: "mcbot" }, allowedUsers: ["ada"] });
    expect(resolveEntries(envEntriesFor(irc), {})).toEqual({ IRC_SERVER: "irc.libera.chat", IRC_CHANNEL: "#ops", IRC_NICKNAME: "mcbot", IRC_ALLOWED_USERS: "ada" });
    expect(hasLiveChannel(irc, {})).toBe(true);
    expect(hasLiveChannel(board({ platform: "irc", settings: { IRC_SERVER: "irc.libera.chat" } }), {})).toBe(false);
  });

  it("keeps a setting out until its app's secret is saved", () => {
    const matrix = board({ platform: "matrix", settings: { MATRIX_HOMESERVER: "https://matrix.org" } });
    expect(resolveEntries(envEntriesFor(matrix), {})).toEqual({});
    expect(resolveEntries(envEntriesFor(matrix), { MCBOT_TEAM_CHAT_MATRIX_ACCESS_TOKEN: "t" })).toEqual({ MATRIX_ACCESS_TOKEN: "t", MATRIX_HOMESERVER: "https://matrix.org" });
  });
});

describe("writeProfileKeys", () => {
  it("writes an owner-only .env, and the Files view neither lists nor shows it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mcbot-keys-"));
    writeFileSync(join(dir, "SOUL.md"), "hi\n");
    await writeProfileKeys(dir, { OPENAI_API_KEY: "sk-1" });
    expect(readFileSync(join(dir, ".env"), "utf8")).toContain('OPENAI_API_KEY="sk-1"');
    if (process.platform !== "win32") expect(statSync(join(dir, ".env")).mode & 0o777).toBe(0o600);

    const folders = new Folders(dir, dir);
    expect((await folders.list(dir, "")).entries.map((e) => e.name)).toEqual(["SOUL.md"]);
    await expect(folders.read(dir, ".env")).rejects.toThrow(/holds keys/);

    await writeProfileKeys(dir, {});
    expect(existsSync(join(dir, ".env"))).toBe(false);
  });
});
