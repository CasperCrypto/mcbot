import { describe, expect, it } from "vitest";
import { LIBRARY } from "../../contracts/library.generated";
import { AgentDataSchema } from "../../contracts/graph";
import { TRAINER_SKILLS, trainerData, trainerTask } from "./trainer";

describe("training on this computer", () => {
  it("uses skills Hermes ships", () => {
    const ids = new Set(LIBRARY.map((s) => s.id));
    for (const id of TRAINER_SKILLS) expect(ids.has(id), id).toBe(true);
  });

  it("is a valid agent", () => {
    expect(AgentDataSchema.safeParse(trainerData()).success).toBe(true);
  });

  it("asks for a model served where McBot finds it, with the dataset and a way to stop", () => {
    const t = trainerTask({ agent: "Writer", dataset: "/Users/me/McBot/datasets/writer-chat.jsonl", examples: 42, baseModel: "" });
    expect(t.title).toBe("Train a model for Writer");
    expect(t.body).toContain("- Data: /Users/me/McBot/datasets/writer-chat.jsonl (42 conversations, OpenAI chat JSONL).");
    expect(t.body).toContain("- Start from: a small instruct model that fits this computer.");
    expect(t.body).toContain("curl http://127.0.0.1:8080/v1/models");
    expect(t.body).toContain("say so and stop");
    expect(trainerTask({ agent: "W", dataset: "d", examples: 1, baseModel: "Qwen3 1.7B" }).body).toContain("- Start from: Qwen3 1.7B.");
  });
});
