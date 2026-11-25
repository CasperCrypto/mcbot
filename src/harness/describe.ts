/**
 * The harness as plain text (Markdown), for any AI or person to read: every agent with what it
 * does, what it thinks with, its tools, chat apps, makers, hand-offs, limits and personality.
 * Pure; ⌘K "Copy the harness as text" puts it on the clipboard. It names keys' variables, never
 * a key's value (boards hold no secrets).
 */
import { CAPABILITIES, DEFAULT_CAPABILITIES, PLATFORMS, type AgentNode, type Graph, type GraphNode } from "../contracts/graph";
import { modelName } from "../app/lib/modelName";
import { chainOf, otherEnd } from "../app/lib/models";

const label = (n: GraphNode) => (n.kind === "agent" ? n.data.displayName || n.data.name : n.data.label || n.data.name);
const quote = (text: string) => text.trim().split("\n").map((l) => `  > ${l}`).join("\n");

function modelLine(n: GraphNode): string {
  if (n.kind !== "model") return label(n);
  const where = n.data.endpoint === "local" ? "on this computer" : "cloud";
  return `${modelName(n.data.model) || n.data.label || n.data.name} (\`${n.data.model || "no model id"}\`, ${where})`;
}

export function describeHarness(g: Graph): string {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const agents = g.nodes.filter((n): n is AgentNode => n.kind === "agent").sort((a, b) => label(a).localeCompare(label(b)));
  const out: string[] = [`# Harness: ${g.name}`, "", `${agents.length} agent${agents.length === 1 ? "" : "s"}, ${g.nodes.length - agents.length} other block${g.nodes.length - agents.length === 1 ? "" : "s"}, ${g.edges.length} wire${g.edges.length === 1 ? "" : "s"}. Compiles to a Hermes Agent setup (one profile per agent).`, ""];
  const wired = new Set<string>();
  for (const a of agents) {
    const d = a.data;
    out.push(`## ${label(a)} (\`${d.name}\`)`, "");
    if (d.description.trim()) out.push(`- Does: ${d.description.trim()}`);
    const chain = chainOf(g, a.id).flatMap((e) => { const m = byId.get(otherEnd(e, a.id) ?? ""); return m ? [m] : []; });
    chain.forEach((m) => wired.add(m.id));
    out.push(chain.length ? `- Thinks with: ${modelLine(chain[0]!)}${chain.length > 1 ? `; falls back to: ${chain.slice(1).map(modelLine).join(", then ")}` : ""}` : "- Thinks with: no model yet");
    const linked = g.edges.flatMap((e) => { const o = byId.get(otherEnd(e, a.id) ?? ""); return o && o.kind !== "model" && o.id !== a.id ? [{ e, o }] : []; });
    const of = (kind: GraphNode["kind"]) => linked.filter((l) => l.o.kind === kind);
    const tools = of("tool").map(({ o }) => {
      wired.add(o.id);
      if (o.kind !== "tool") return label(o);
      const only = o.data.toolsInclude?.length ? `; only ${o.data.toolsInclude.join(", ")}` : "";
      return `${label(o)} (MCP \`${o.data.name}\`, ${o.data.transport === "http" ? "online" : "on this computer"}${only})`;
    });
    if (tools.length) out.push(`- Uses: ${tools.join("; ")}`);
    const apps = of("channel").map(({ o }) => { wired.add(o.id); return o.kind === "channel" ? `${PLATFORMS[o.data.platform]?.label ?? o.data.platform}` : label(o); });
    if (apps.length) out.push(`- Answers on: ${apps.join(", ")}`);
    const makers = of("media").map(({ o }) => { wired.add(o.id); return o.kind === "media" ? `${o.data.media === "video" ? "videos" : "images"} with ${o.data.provider}` : label(o); });
    if (makers.length) out.push(`- Makes: ${makers.join(", ")}`);
    const hands = linked.filter(({ e, o }) => o.kind === "agent" && e.source === a.id).map(({ o }) => label(o));
    if (hands.length) out.push(`- Hands work to: ${hands.join(", ")}`);
    const caps = d.capabilities ?? DEFAULT_CAPABILITIES;
    out.push(`- Can use: ${d.capabilities ? "" : "(Hermes' default) "}${CAPABILITIES.filter((c) => caps.includes(c.key)).map((c) => c.label).join(", ")}`);
    const limits = [
      d.reasoning ? `thinking ${d.reasoning}` : null,
      d.maxSteps ? `up to ${d.maxSteps} steps per message` : null,
      d.approvals ? `approvals ${d.approvals === "manual" ? "always ask" : d.approvals === "off" ? "never ask" : "smart"}` : null,
      d.neverRun?.length ? `never runs ${d.neverRun.map((c) => `\`${c}\``).join(", ")}` : null,
      d.blockedSites?.length ? `blocked websites ${d.blockedSites.join(", ")}` : null,
      d.dailyBudgetUsd ? `daily budget $${d.dailyBudgetUsd}` : null,
      d.builtinSkills === false ? "no built-in skills" : null,
      d.skills.length ? `${d.skills.length} skill${d.skills.length === 1 ? "" : "s"} of its own (${d.skills.map((s) => s.name).join(", ")})` : null,
    ].filter(Boolean);
    if (limits.length) out.push(`- Settings: ${limits.join("; ")}`);
    if (d.soul.trim()) out.push("- Personality:", quote(d.soul));
    out.push("");
  }
  const loose = g.nodes.filter((n) => n.kind !== "agent" && !wired.has(n.id));
  if (loose.length) out.push("## Not wired to any agent", "", ...loose.map((n) => `- ${n.kind}: ${n.kind === "model" ? modelLine(n) : label(n)}`), "");
  return `${out.join("\n").trimEnd()}\n`;
}
