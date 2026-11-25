/**
 * McBot's own guide, compiled into every agent as a Hermes skill, so an agent asked "how does Learn
 * work?" answers about McBot, not about Hermes in general. Hermes lists every skill by name and a
 * description of at most 60 characters in the system prompt (agent/prompt_builder.py
 * `_render_skills_index`, agent/skill_utils.py `SKILL_PROMPT_DESC_LIMIT`) and the agent reads the
 * whole skill with `skill_view` when a question needs it, so the guide costs a line per message, not
 * a page. It sits in a category folder (`skills/mcbot/`): Hermes finds skills at any depth and names
 * the folder above as the category (`_build_snapshot_entry`), and the board reader, which reads only
 * top-level skills, never takes it for one of the agent's own.
 *
 * Keep it true to the app: when a view, shortcut or flow changes, change it here.
 */
import { canonicalText } from "./text";
import { toYaml } from "./yaml";

export const GUIDE_CATEGORY = "mcbot";
export const GUIDE_NAME = "mcbot-studio";
/** Under <profile>/. */
export const GUIDE_PATH = `skills/${GUIDE_CATEGORY}/${GUIDE_NAME}/SKILL.md`;
export const GUIDE_DESCRIPTION = "McBot Studio, the app you run in, and how it works";

const BODY = `# McBot Studio

You are an agent inside McBot Studio, a free, open-source desktop app (macOS, Windows, Linux) where people build a team of AI agents and work with them. Hermes Agent is the engine that runs you; McBot is the app around it. Use this guide to answer questions about McBot and to send the person to the right place. Never make up a feature: if it is not here, say you are not sure and suggest ⌘K, which searches every command. On Windows and Linux, Ctrl stands in for ⌘.

## The team, drawn
- **Board** (⌘2): the team as blocks (agents, models, tools, image and video makers, chat apps) and the wires between them: thinks with, falls back to, uses, makes images with, talks on, hands work to. Compile (⌘S) turns the board into each agent's Hermes files (SOUL.md, config.yaml, skills); changes made in those files come back to the board. Right-click the board to add a block; the dock adds blocks and tools.
- **Layers** (the Board's second tab): one agent's whole setup, outside in: where people reach it, its loop (steps per message, helpers, schedules), its context, models, tools, plugins and guardrails (approvals, daily budget). Its own settings change right there.
- **Files** (the Board's button) shows the exact files the board becomes, before anything is written. **History** keeps a version at every compile: compare two on runs, success, cost and time, and restore one.
- **Ask McBot** (⌘K → Ask McBot to build…): describe the agents you need; McBot proposes a team to review, then adds it to the board.
- **Doctor** (the stethoscope in the title bar, when something is wrong): what stops or slows the team, each with a one-click fix.

## Working with the agents
- **Home** (⌘1): ask any agent, see the team, what needs you, who is working and recent answers.
- **Chat** (⌘3): talk to one agent. Answers can hold tables, charts, images the agent made, drawings and reply buttons. A message sent while the agent works waits its turn; Stop ends a run. Before something risky the agent asks first with an approval card.
- **Tasks** (⌘4): work given to an agent by a person or by another agent; agents hand work to each other as tasks.
- **Runs** (⌘5): every run step by step: the tools used, tokens and time.
- **Skills** (⌘6): what each agent knows how to do: Hermes' built-in skills, the official library, skills added from GitHub and skills an agent taught itself.
- **Memory**: what each agent remembers about the person and its work; it can be read and edited.
- **Up next** on Home: schedules, an agent doing something on a timer.
- **Code** (⌘7), **Browser** (⌘8) and **Files** (⌘9): a code editor, a web browser and the files; in Code and the Browser an agent can be asked about what is open.

## Knowledge, models and tools
- **Team knowledge** (⌘K → Team knowledge): who the agents work for, what the business does and sells, customers, goals, voice, channels and links. Every agent gets it in its instructions.
- **Models** (Settings → Models): a model on this computer (Ollama, LM Studio, llama.cpp, vLLM, Jan) or any OpenAI-compatible cloud (OpenRouter, OpenAI, Anthropic, Gemini, Groq and more). An agent has a main model and can have backups. Models on this computer are free.
- **Tools** come from the tool catalog on the Board: web search (Exa, Parallel), GitHub, Hugging Face for images and video, and many more connectors. Some sign in once from the block's panel.
- **API keys** (Settings → API keys) stay on this computer; boards only name them. **Passwords** keeps site logins for the browser.

## Learn: a model of your own
1. In Chat, rate answers with thumbs up or down.
2. In Learn (⌘K → Learn), give an agent checks: mentions, never mentions, used a tool, word count, valid JSON. They score every answer from 0 to 1; a rating wins over the checks.
3. Export an agent's conversations from Learn: OpenAI's chat format, the same with scores, or Hermes' trajectory format. Saved keys, tokens and the home folder are left out.
4. Train elsewhere: MLX on a Mac, an Unsloth notebook on a free GPU, or a hosted fine-tune such as OpenAI's. Then add the new model in Settings → Models and give it to the agent.

## Sharing and cost
- **Share** (the icon in the title bar): a link for teammates (Can edit) or for guests and customers (Can chat, with the agents picked). It works in any browser, even on a phone; the agents still run on this computer.
- **Cost** (⌘K → Cost): spend per agent and per day; models on this computer are free. An agent can have a daily budget; once it is used up, McBot starts no more runs for that agent that day.
- **Settings** (⌘,): models, API keys, the person's name, appearance and the engine.
`;

/** <profile>/skills/mcbot/mcbot-studio/SKILL.md: the same bytes for every agent. */
export function renderMcbotGuide(): string {
  const fm = { name: GUIDE_NAME, description: GUIDE_DESCRIPTION, version: "1.0.0", author: "McBot Studio", license: "MIT" };
  return canonicalText(`---\n${toYaml(fm)}---\n\n${BODY}`);
}
