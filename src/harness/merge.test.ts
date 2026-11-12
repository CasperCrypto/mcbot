import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compile } from "../compile";
import { mergeConfig } from "./merge";

const FIXTURES = join(import.meta.dirname, "../../test/fixtures");
const configs = readdirSync(FIXTURES)
  .filter((f) => f.endsWith(".graph.json"))
  .flatMap((f) => compile(JSON.parse(readFileSync(join(FIXTURES, f), "utf8"))).files.filter((x) => x.role === "config").map((x) => [x.path, x.content] as const));

const HEAD = "# Compiled by McBot.\n";
const compiled = (body: string) => `${HEAD}${body}`;

describe("careful writer: config.yaml", () => {
  it.each(configs)("%s: a file McBot just wrote merges to the same bytes", (_path, content) => {
    expect(mergeConfig(content, content)).toBe(content);
    // Also when parsed and rebuilt (no shortcut on equal text).
    expect(mergeConfig(`${content}\n`, content)).toBe(content);
  });

  it.each(configs)("%s: every key compile writes is one McBot owns (nothing of the board's is left behind)", (_path, content) => {
    const header = /^(#.*\n)*/.exec(content)![0];
    expect(mergeConfig("keep_me: 1\n", content)).toBe(`${header}keep_me: 1\n${content.slice(header.length)}`);
  });

  it("writes a new file as compiled", () => {
    expect(mergeConfig(null, compiled("a: 1\n"))).toBe(compiled("a: 1\n"));
  });

  it("changes McBot's keys and keeps everyone else's, with their comments and order", () => {
    const disk = [
      HEAD.trimEnd(),
      "model:",
      "  provider: custom:mcbot-local",
      "  default: old-model",
      "  context_length: 32768",
      "# The person's memory provider",
      "memory:",
      "  provider: holographic",
      "providers:",
      "  mcbot-local:",
      "    api: http://127.0.0.1:11434/v1",
      "  openrouter:",
      "    api: https://openrouter.ai/api/v1",
      "browser:",
      "  headed: true",
      "  cdp_url: http://127.0.0.1:9222",
      "cron:",
      "  wrap_response: false",
      "",
    ].join("\n");
    const next = compiled([
      "model:",
      "  provider: custom:mcbot-local",
      "  default: qwen3:8b",
      "providers:",
      "  mcbot-local:",
      "    api: http://127.0.0.1:11434/v1",
      "    default_model: qwen3:8b",
      "platform_toolsets:",
      "  cli:",
      "    - web",
      "",
    ].join("\n"));
    expect(mergeConfig(disk, next)).toBe([
      "# Compiled by McBot.",
      "model:",
      "  provider: custom:mcbot-local",
      "  default: qwen3:8b",
      "  context_length: 32768",
      "# The person's memory provider",
      "memory:",
      "  provider: holographic",
      "providers:",
      "  mcbot-local:",
      "    api: http://127.0.0.1:11434/v1",
      "    default_model: qwen3:8b",
      "  openrouter:",
      "    api: https://openrouter.ai/api/v1",
      "browser:",
      "  cdp_url: http://127.0.0.1:9222",
      "cron:",
      "  wrap_response: false",
      "platform_toolsets:",
      "  cli:",
      "    - web",
      "",
    ].join("\n"));
  });

  it("removes what the board removed, and a map it emptied", () => {
    const disk = "model:\n  provider: custom:mcbot-a\n  default: m\nbrowser:\n  headed: true\nmcp_servers:\n  git:\n    command: uvx\n  Weird.Name:\n    command: x\n";
    expect(mergeConfig(disk, compiled("model:\n  provider: custom:mcbot-a\n  default: m\n"))).toBe(
      compiled("model:\n  provider: custom:mcbot-a\n  default: m\nmcp_servers:\n  Weird.Name:\n    command: x\n"),
    );
  });

  it("leaves a maker the board cannot show alone", () => {
    const disk = "image_gen:\n  provider: comfyui\n  model: sdxl\n  steps: 30\n";
    expect(mergeConfig(disk, compiled("model:\n  provider: custom:mcbot-a\n"))).toBe(compiled("image_gen:\n  provider: comfyui\n  model: sdxl\n  steps: 30\nmodel:\n  provider: custom:mcbot-a\n"));
  });

  it("replaces a file Hermes could not read either", () => {
    expect(mergeConfig("- a\n- b\n", compiled("a: 1\n"))).toBe(compiled("a: 1\n"));
    expect(mergeConfig("a: [\n", compiled("a: 1\n"))).toBe(compiled("a: 1\n"));
  });
});
