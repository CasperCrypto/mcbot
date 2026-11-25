# Training your own model on your agents' work

Your agents already do your real work: your customers' questions, your posts, your reports. That
work is the best training data you will ever have. McBot keeps it, grades it and trains a model of
your own on it, in the cloud or on this computer, then wires that model back to the agent. It all
lives in **Knowledge → Training** (⌘6).

## What McBot does today

| Piece | Where | What it is |
|---|---|---|
| Every run, recorded | `~/McBot/runs/<run>.jsonl` | The prompt, every tool the agent called with its input and result, the answer, tokens, cost, time (`src/contracts/run.ts`) |
| Full conversations | each agent's `state.db` (Hermes) | Every session's messages with tool calls; McBot reads it for cost |
| Ratings | `~/McBot/ratings.json` | Thumbs up or down on any answer in Chat |
| Checks | on the board (an agent's `checks`, never compiled) | Automatic graders: mentions, never mentions, used a tool, at least / at most N words, valid JSON |
| Reward | `src/harness/learn.ts` `rewardOf` | 0 to 1: the person's rating, else the share of checks passed; failed or stopped runs are 0 |
| Datasets | Training → Export → `~/McBot/datasets/` | One agent's conversations (runs of one session together) in three formats, keys and tokens left out |
| Training in the cloud | Training → Train → In the cloud (`engine/train.ts`) | The good conversations go to a board cloud model's OpenAI fine-tuning API; McBot follows the job |
| Training on this computer | Training → Train → On this computer (`src/app/lib/trainer.ts`) | A Trainer agent gets an Until-done task: fine-tune with Unsloth, serve with llama.cpp |
| Using the result | Training → Models → Use it | The trained model becomes the agent's main model; the old one stays as its backup |

The three export formats:

- **Chat**: OpenAI's fine-tuning format, `{"messages": [...]}` with `tool_calls` and tool results.
  OpenAI and Together fine-tuning, Unsloth, Hugging Face TRL and MLX-LM read it as is.
- **With rewards**: the same, plus `"reward": 0.83`, for filtering, preference training (DPO) or RL.
- **Hermes**: Hermes' own trajectory format (`agent/trajectory.py` `save_trajectory`):
  `{"conversations": [{"from": "system" | "human" | "gpt" | "tool", "value": ...}], ...}` with
  `<tool_call>` and `<tool_response>` blocks. This is the shape Nous Research's tooling reads,
  including `trajectory_compressor.py`.

## Train it

1. **Rate a week of answers** in Chat, and give each agent two or three checks in Training (a
   designer: "Used the tool: image_generate"; a support agent: "Never mentions: refund guaranteed").
   Fifty to a few hundred good conversations teach a small model your tone, your formats and your
   tools; the cloud needs at least 10.
2. **Train**, on the agent's card in Training:
   - **In the cloud**: pick one of the board's cloud models (its key is already saved) and the model
     to start from, one your provider can fine-tune (its fine-tuning docs list them). McBot uploads the good conversations (`POST /files`), starts the job
     (`POST /fine_tuning/jobs`), and asks how it is going while Training is open. The dataset and
     the key go only to that provider. A provider without the fine-tuning API says so and nothing
     is sent after the refusal.
   - **On this computer**: McBot adds a **Trainer** agent (same models as the agent, Hermes'
     `official/mlops/training/unsloth` and `official/mlops/inference/llama-cpp` skills) and gives it
     an Until-done task with the dataset. It checks the hardware, trains a LoRA, exports GGUF and
     serves it at `http://127.0.0.1:8080`, where Settings → Models finds it. The data never leaves the
     computer. It needs a GPU or Apple silicon with enough memory; if it can't, it says so and stops.
3. **Use it**: when a cloud job is Ready, **Use it** places the trained model on the board as the
   agent's main model and keeps the old one as its backup (compile to apply). A model the Trainer
   serves is added like any local model: Settings → Models → it is found at :8080.
4. **Compare**: History keeps every version of the harness with its runs' success, cost and time,
   so you can see whether your model does the job better or cheaper than the one before.

Prefer your own tools? Export "Chat", "The good ones" and train anywhere:
[MLX-LM](https://github.com/ml-explore/mlx-lm/blob/main/mlx_lm/LORA.md) on a Mac with Apple silicon
(`mlx_lm.lora --model <model> --train --data <folder>` with the file as `train.jsonl`),
[Unsloth's notebooks](https://docs.unsloth.ai/get-started/fine-tuning-llms-guide) on a free GPU, or a
hosted fine-tuning service. Serve the result with Ollama, LM Studio or vLLM and add it in Settings →
Models.

## The plan: from a log of work to a self-improving loop

The request was four things: sandboxed reset, trajectory logging, verifiable rewards, and an RL
loop. Here is where each one stands, and the next steps, in order.

### 1. Trajectory logging (done, keep extending)

Done: every run is recorded as structured events; Training exports them as chat, reward and
Hermes trajectory JSONL.

Next:
- Parquet next to JSONL, for Hugging Face datasets of many thousands of rows.
- Each example carries the agent's tool schemas (`tools`), so a trained model learns the exact
  signatures.
- Per-turn rewards in multi-turn conversations, not only per conversation.
- Hermes' own `--save-trajectories` stays off in McBot's runs: McBot's record is the same data,
  with McBot's redaction, and needs no change in Hermes.

### 2. Verifiable rewards, `verify()` (started)

Done: deterministic checks per agent, and human ratings, both turned into a 0 to 1 reward.

Next, by how often teams will need them:
1. **Rubric judge**: a check that asks the board's own model to grade the answer against a rubric
   you write ("names the price, offers one next step, under 80 words"), cached per run. It runs on
   the same OpenAI-compatible endpoint (hard rule 4), never a vendor SDK.
2. **File checks**: the agent's output file exists, parses (JSON, CSV), matches a schema.
3. **Command checks** for coding agents: run the project's tests in the agent's workspace; pass is 1.
4. **Data checks**: a read-only query against a database the agent changed, compared with what it
   should be.

### 3. Sandboxed state and `reset()` (next)

Hermes already runs an agent's terminal and code in a sandbox when asked:
`terminal.backend` takes `local` (the default) or a container backend
(`hermes/tools/environments/`: Docker, Modal, Daytona, SSH and others).

Next:
1. A "Run in a sandbox" switch per agent that compiles `terminal.backend: docker`. Before it ships,
   the key, its options (image, mounts) and their defaults get verified in Hermes' source and
   recorded in `docs/HERMES.md` (hard rule 2), and it is tested on macOS, Windows and Linux with
   Docker Desktop.
2. `reset()`: each run starts from a fresh container and a snapshot of the shared files folder,
   so practice runs never touch real data.
3. MCP tools that change the world (email, CRM, payments) get a "practice" twin, a recorded or fake
   server, so rollouts can't send real messages.

### 4. The training loop (later, on a GPU machine)

The loop, with McBot as the place you set it up and watch it:

1. **Tasks**: a set of real prompts per agent, from Tasks, from Home's "Lately" or a file.
2. **Rollouts**: run them against a candidate model. Hermes ships `batch_runner.py` for exactly
   this: a JSONL of prompts, parallel workers, trajectories and tool statistics out.
3. **Verify**: grade each rollout with the agent's checks and rubric.
4. **Train**: SFT on the good ones, DPO on good and bad pairs, or GRPO-style RL with the rewards.
   Use TRL or Unsloth on one GPU, or Nous Research's Atropos for online RL at scale.
5. **Compare and promote**: the new model goes on the board as a model block; History compares
   its runs with the old one's; keep the winner.

McBot's job is steps 1, 2, 3 and 5, on the desktop. Step 4 runs where the GPUs are: today, a
fine-tuning API (Training → In the cloud) or this computer's own GPU (the Trainer agent); later a
rented cloud GPU for RL.

## The repositories that came up

- **train-llm-from-scratch**: a teaching project for pretraining a tiny model. A company doesn't
  need to pretrain: fine-tuning an open model on its own data gets further for far less.
- **NVIDIA DALI**: fast loading of images and video for training vision models. Not part of how
  agents learn.
- **Hugging Face transformers** (with TRL): the library most fine-tuning runs on. The "Chat"
  export loads with `datasets.load_dataset("json", data_files=...)`. It belongs on the training
  machine, not inside McBot.
- **Megatron-LM**: training across thousands of GPUs. Far beyond what this needs.
- **OpenVINO**: fast inference on Intel CPUs and GPUs. Its model server speaks the OpenAI API, so a
  model served with it already works in McBot as a local model (Settings → Models → its address).
