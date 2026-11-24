import { describe, expect, it } from "vitest";
import { modelFamily, modelName } from "./modelName";

describe("modelName", () => {
  it("reads model ids the way people say them", () => {
    expect(modelName("anthropic/claude-sonnet-4.5")).toBe("Claude Sonnet 4.5");
    expect(modelName("claude-sonnet-4-5")).toBe("Claude Sonnet 4.5");
    expect(modelName("claude-opus-4-1-20250805")).toBe("Claude Opus 4.1");
    expect(modelName("openai/gpt-4o-mini")).toBe("GPT-4o mini");
    expect(modelName("gpt-5")).toBe("GPT-5");
    expect(modelName("qwen3:8b")).toBe("Qwen3 8B");
    expect(modelName("qwen3:latest")).toBe("Qwen3");
    expect(modelName("llama-3.3-70b-versatile")).toBe("Llama 3.3 70B Versatile");
    expect(modelName("meta-llama/Llama-3.3-70B-Instruct-Turbo")).toBe("Llama 3.3 70B Instruct Turbo");
    expect(modelName("gemini-2.5-flash")).toBe("Gemini 2.5 Flash");
    expect(modelName("deepseek-chat")).toBe("DeepSeek Chat");
    expect(modelName("mistral-small-latest")).toBe("Mistral Small");
    expect(modelName("x-ai/grok-4")).toBe("Grok 4");
  });

  it("keeps an id it cannot read, and an empty one empty", () => {
    expect(modelName("")).toBe("");
    expect(modelName("m")).toBe("m");
  });
});

describe("modelFamily", () => {
  it("finds the family from the id, else the server", () => {
    expect(modelFamily("anthropic/claude-sonnet-4.5")).toBe("claude");
    expect(modelFamily("openai/gpt-4o-mini")).toBe("openai");
    expect(modelFamily("o3-mini")).toBe("openai");
    expect(modelFamily("qwen3:8b")).toBe("qwen");
    expect(modelFamily("llama-3.3-70b-versatile")).toBe("meta");
    expect(modelFamily("gemma3:4b")).toBe("gemma");
    expect(modelFamily("gemini-2.5-flash")).toBe("gemini");
    expect(modelFamily("x-ai/grok-4")).toBe("grok");
    expect(modelFamily("deepseek-chat")).toBe("deepseek");
    expect(modelFamily("my-finetune", "http://127.0.0.1:11434/v1")).toBe("ollama");
    expect(modelFamily("something", "https://openrouter.ai/api/v1")).toBe("openrouter");
    expect(modelFamily("something")).toBeNull();
  });
});
