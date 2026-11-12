/** "mcp__docs__search" → "Docs: search"; "web_search" → "Web search". The raw name is in the tooltip. */
export function toolLabel(tool: string): string {
  const words = (s: string) => s.replace(/[_-]+/g, " ").trim();
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const m = /^mcp__(.+?)__(.+)$/.exec(tool);
  return m ? `${cap(words(m[1]!))}: ${words(m[2]!)}` : cap(words(tool));
}
