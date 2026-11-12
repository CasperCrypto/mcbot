import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { envFacts, isHermesHome, readSetup } from "./harnessDisk";

function home(): string {
  const root = mkdtempSync(join(tmpdir(), "mcbot-hermes-home-"));
  // The default profile: the root itself, on a local model, with a bot and a memory provider.
  writeFileSync(join(root, "config.yaml"), [
    "model:", "  provider: custom:mcbot-local", "  default: qwen3:8b",
    "providers:", "  mcbot-local:", "    api: http://127.0.0.1:11434/v1", "    default_model: qwen3:8b", "    transport: chat_completions",
    "memory:", "  provider: holographic", "",
  ].join("\n"));
  writeFileSync(join(root, "SOUL.md"), "# Main\n\nHelps with everything.\n");
  writeFileSync(join(root, ".env"), 'TELEGRAM_BOT_TOKEN="123:secret"\nTELEGRAM_ALLOWED_USERS=111, 222\nOPENAI_API_KEY=\n');
  // A second profile with a tool and an own skill, plus a seeded skill category.
  const coder = join(root, "profiles", "coder");
  mkdirSync(join(coder, "skills", "review"), { recursive: true });
  mkdirSync(join(coder, "skills", "software-development", "tdd"), { recursive: true });
  writeFileSync(join(coder, "config.yaml"), "mcp_servers:\n  git:\n    command: uvx\n    args:\n      - mcp-server-git\n");
  writeFileSync(join(coder, "profile.yaml"), "display_name: Coder\n");
  writeFileSync(join(coder, "skills", "review", "SKILL.md"), "---\nname: review\ndescription: Review a diff\nversion: 1.0.0\n---\n\nRead the diff.\n");
  writeFileSync(join(coder, "skills", "software-development", "tdd", "SKILL.md"), "---\nname: tdd\n---\n");
  return root;
}

describe("a Hermes setup on disk → board", () => {
  it("draws the default profile as `main`, every profile, its tools, skills and bot", async () => {
    const root = home();
    expect(await isHermesHome(root)).toBe(true);
    const { graph, unshown } = await readSetup(root, { id: "my-hermes", name: "My Hermes" });
    const agents = graph.nodes.filter((n) => n.kind === "agent").map((n) => n.data.name);
    expect(agents.sort()).toEqual(["coder", "main"]);
    const coder = graph.nodes.find((n) => n.id === "n-agent-coder")!;
    expect(coder.data).toMatchObject({ displayName: "Coder", skills: [{ name: "review", body: "Read the diff." }] });
    expect(graph.nodes.find((n) => n.kind === "tool")?.data).toMatchObject({ name: "git", command: "uvx", args: ["mcp-server-git"] });
    expect(graph.nodes.find((n) => n.kind === "model")?.data).toMatchObject({ endpoint: "local", model: "qwen3:8b" });
    // The bot comes from .env: which users may talk to it, never the token.
    const bot = graph.nodes.find((n) => n.kind === "channel")!;
    expect(bot.data).toMatchObject({ platform: "telegram", tokenEnv: "", allowedUsers: ["111", "222"] });
    expect(JSON.stringify(graph)).not.toContain("secret");
    expect(unshown.map((u) => `${u.profile}: ${u.what}`)).toEqual([
      "main: default profile", "coder: skills/software-development", "main: config.yaml: memory",
    ]);
  });

  it("reads which keys a .env sets, and only the allowed users' value", () => {
    const f = envFacts('A=1\nexport B="x"\nEMPTY=\n# C=3\nTELEGRAM_ALLOWED_USERS="5,abc,6"\n');
    expect([...f.names].sort()).toEqual(["A", "B", "TELEGRAM_ALLOWED_USERS"]);
    expect(f.allowedTelegram).toEqual(["5", "6"]);
  });

  it("knows a folder that is not a Hermes home", async () => {
    expect(await isHermesHome(mkdtempSync(join(tmpdir(), "mcbot-empty-")))).toBe(false);
  });
});
