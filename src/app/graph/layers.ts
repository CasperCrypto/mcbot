/**
 * An agent's harness as layers, outside in: where people reach it, how it loops through a task,
 * what it knows, what it thinks with, what it can use, what extends it, and what keeps it safe.
 * Pure: a resolved agent and what the engine reported in, the layers out (tested). Every item says
 * where it is changed, so the Layers view only ever links to what compiles (or to Hermes' own state).
 */
import type { AgentBundle } from "../../compile/validate";
import { DEFAULT_CAPABILITIES } from "../../contracts/graph";
import type { AgentMemoryView, InstalledPlugin, ScheduleView } from "../../contracts/api";

export type LayerId = "surfaces" | "loop" | "context" | "model" | "tools" | "plugins" | "guardrails";

/** Where an item is changed: a block on the board, or a view. */
export type LayerTarget = { node: string } | { tab: "skills" | "memory" | "home" | "tasks" | "settings" | "agents" };

export interface LayerItem {
  label: string;
  detail: string;
  /** "set": the board sets it; "default": Hermes' default; "missing": it won't work without it. */
  state: "set" | "default" | "missing";
  target: LayerTarget;
}

export interface Layer {
  id: LayerId;
  title: string;
  /** One line on what the layer is (a tooltip). */
  what: string;
  items: LayerItem[];
}

export interface LayerFacts {
  memory?: AgentMemoryView | null;
  schedules?: ScheduleView[] | null;
  plugins?: InstalledPlugin[] | null;
  /** Library skills installed in the profile (names). */
  installedSkills?: string[] | null;
}

const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;

export function harnessLayers(b: AgentBundle, facts: LayerFacts = {}): Layer[] {
  const a = b.agent.data;
  const self = { node: b.agent.id };
  const caps = a.capabilities ?? DEFAULT_CAPABILITIES;
  const [primary, ...fallbacks] = b.models;
  const soulLines = a.soul.split("\n").filter((l) => l.trim()).length;
  const memEntries = facts.memory ? facts.memory.memory.entries.length + facts.memory.user.entries.length : null;
  const enabledPlugins = facts.plugins?.filter((p) => p.enabled) ?? null;

  return [
    {
      id: "surfaces", title: "Surfaces", what: "Where people reach this agent",
      items: [
        { label: "McBot chat", detail: "Always on", state: "set", target: { tab: "agents" } },
        ...b.channels.map((c): LayerItem => ({ label: c.data.label || c.data.platform, detail: c.data.allowedUsers.length ? n(c.data.allowedUsers.length, "person", "people") + " may message it" : "Nobody may message it yet", state: c.data.allowedUsers.length ? "set" : "missing", target: { node: c.id } })),
        ...(b.channels.length ? [] : [{ label: "Chat apps", detail: "None: add Slack, Telegram, WhatsApp… from the dock", state: "default" as const, target: self }]),
      ],
    },
    {
      id: "loop", title: "Loop", what: "How it works through a task: steps, hand-offs, schedules",
      items: [
        { label: "Steps per message", detail: a.maxSteps ? `Up to ${a.maxSteps}` : "No limit (Hermes' default)", state: a.maxSteps ? "set" : "default", target: self },
        { label: "Hands work to", detail: b.team.length ? b.team.map((t) => t.data.displayName || t.data.name).join(", ") : "Nobody", state: b.team.length ? "set" : "default", target: self },
        { label: "Helpers", detail: caps.includes("delegation") ? "Can start helpers for parts of a task" : "Off", state: caps.includes("delegation") ? "default" : "set", target: self },
        { label: "Schedules", detail: facts.schedules == null ? "—" : facts.schedules.length ? n(facts.schedules.length, "schedule") : "None", state: facts.schedules?.length ? "set" : "default", target: { tab: "home" } },
      ],
    },
    {
      id: "context", title: "Context", what: "What it knows before it answers: who it is, memory, skills",
      items: [
        { label: "Identity", detail: soulLines ? `${n(soulLines, "line")} in SOUL.md` : "Empty: say who it is and how it works", state: soulLines ? "set" : "missing", target: self },
        { label: "Memory", detail: memEntries == null ? "—" : memEntries ? n(memEntries, "memory", "memories") : "Nothing yet", state: memEntries ? "set" : "default", target: { tab: "memory" } },
        { label: "Skills", detail: [a.skills.length ? n(a.skills.length, "own") : "", a.builtinSkills === false ? "built-in off" : "44 built-in", facts.installedSkills?.length ? `${facts.installedSkills.length} from the library` : ""].filter(Boolean).join(" · "), state: a.skills.length || facts.installedSkills?.length ? "set" : "default", target: { tab: "skills" } },
        { label: "Long chats", detail: "Hermes compacts the conversation when it fills half the window", state: "default", target: { tab: "settings" } },
      ],
    },
    {
      id: "model", title: "Model", what: "What it thinks with, and what takes over when that fails",
      items: primary
        ? [
            { label: primary.data.label || primary.data.name, detail: `${primary.data.model} · ${primary.data.endpoint === "local" ? "on this computer" : "cloud"}`, state: "set", target: { node: primary.id } },
            ...fallbacks.map((m): LayerItem => ({ label: `Backup: ${m.data.label || m.data.name}`, detail: m.data.model, state: "set", target: { node: m.id } })),
            { label: "Thinking", detail: a.reasoning ? (a.reasoning === "none" ? "Off" : `${a.reasoning[0]!.toUpperCase()}${a.reasoning.slice(1)} effort`) : "As the model decides (Hermes' default)", state: a.reasoning ? "set" : "default", target: self },
          ]
        : [{ label: "No model", detail: "Wire a model to it on the board", state: "missing", target: self }],
    },
    {
      id: "tools", title: "Tools", what: "What it can use: abilities, connectors, makers",
      items: [
        { label: "Abilities", detail: a.capabilities ? n(caps.length, "ability", "abilities") + " chosen" : `${n(caps.length, "ability", "abilities")} (Hermes' default)`, state: a.capabilities ? "set" : "default", target: self },
        ...b.tools.map((t): LayerItem => ({ label: t.data.label || t.data.name, detail: `${t.data.transport === "http" ? "Connector" : "Local tool"}${t.data.toolsInclude?.length ? ` · only ${t.data.toolsInclude.length} of its tools` : ""}`, state: "set", target: { node: t.id } })),
        ...[b.image, b.video].filter((m): m is NonNullable<typeof m> => !!m).map((m): LayerItem => ({ label: m.data.label || `${m.data.media === "image" ? "Image" : "Video"} maker`, detail: m.data.provider, state: "set", target: { node: m.id } })),
      ],
    },
    {
      id: "plugins", title: "Plugins", what: "Hermes plugins that extend it",
      items: [{ label: "Plugins", detail: enabledPlugins == null ? "—" : enabledPlugins.length ? enabledPlugins.map((p) => p.name).join(", ") : "None on", state: enabledPlugins?.length ? "set" : "default", target: { tab: "skills" } }],
    },
    {
      id: "guardrails", title: "Guardrails", what: "What keeps it safe and affordable",
      items: [
        { label: "Approvals", detail: "Asks you before risky commands", state: "default", target: { tab: "settings" } },
        { label: "Daily budget", detail: a.dailyBudgetUsd ? `$${a.dailyBudgetUsd} a day` : "No limit", state: a.dailyBudgetUsd ? "set" : "default", target: self },
      ],
    },
  ];
}
