/**
 * Training on this computer is an agent's work: a Trainer with Hermes' own fine-tuning and serving skills
 * (official/mlops/training/unsloth, official/mlops/inference/llama-cpp) gets an Until-done task with the
 * dataset, trains a LoRA, and serves the result on llama.cpp's usual address, where Settings → Models
 * finds it. Pure: what the Trainer is and what it is asked.
 */
import type { AgentData } from "../../contracts/graph";

export const TRAINER_NAME = "trainer";
export const TRAINER_SKILLS = ["official/mlops/training/unsloth", "official/mlops/inference/llama-cpp"] as const;
/** llama.cpp's server's usual address (McBot looks for a model there). */
export const TRAINED_URL = "http://127.0.0.1:8080";

export function trainerData(): AgentData {
  return {
    name: TRAINER_NAME,
    displayName: "Trainer",
    description: "Fine-tunes and serves models of your own on this computer",
    soul: [
      "You train small open models on this computer, from the team's own conversations.",
      "Check the hardware first (GPU or Apple silicon, memory, disk) and pick what fits.",
      "Say what a long step will do before you start it. Never upload the data anywhere.",
    ].join("\n"),
    skills: [],
    capabilities: null,
  } as AgentData;
}

export function trainerTask(o: { agent: string; dataset: string; examples: number; baseModel: string }): { title: string; body: string } {
  const from = o.baseModel.trim() || "a small instruct model that fits this computer";
  return {
    title: `Train a model for ${o.agent}`,
    body: [
      `Fine-tune a model on ${o.agent}'s best conversations so it answers the way ${o.agent} does at its best.`,
      "",
      `- Data: ${o.dataset} (${o.examples} conversation${o.examples === 1 ? "" : "s"}, OpenAI chat JSONL).`,
      `- Start from: ${from}.`,
      "- Train a LoRA with Unsloth (your unsloth skill), sized for this computer.",
      `- Export it as GGUF and serve it with llama.cpp's server at ${TRAINED_URL}, OpenAI-compatible (your llama-cpp skill).`,
      "",
      `Done when \`curl ${TRAINED_URL}/v1/models\` lists the model. Reply with where the model is, the server's address and how long training took. If this computer can't train it (no GPU, too little memory), say so and stop.`,
    ].join("\n"),
  };
}
