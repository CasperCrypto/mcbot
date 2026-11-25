/**
 * Agents as Picker options: face and name; two agents with the same name (two starter teams'
 * Writers) also say what each is for, so they can be told apart.
 */
import type { AgentNode } from "../../contracts/graph";
import type { PickerOption } from "../Picker";
import { AgentFace } from "../ui";

export const agentLabel = (a: AgentNode): string => a.data.displayName || a.data.name;

export function agentOptions(agents: readonly AgentNode[], value: (a: AgentNode) => string = (a) => a.id): PickerOption[] {
  const seen = new Map<string, number>();
  for (const a of agents) seen.set(agentLabel(a), (seen.get(agentLabel(a)) ?? 0) + 1);
  return agents.map((a) => ({
    value: value(a),
    label: agentLabel(a),
    sub: (seen.get(agentLabel(a)) ?? 0) > 1 ? a.data.description?.trim() || a.data.name : undefined,
    icon: <AgentFace seed={a.data.name} size={18} />,
  }));
}
