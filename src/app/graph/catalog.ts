/**
 * Ready-made tools: MCP servers people use most, each a tool node in one click. Every entry was
 * checked on npm (published, not deprecated, licence) and its key variable read from the
 * package's own README. They run with `npx` on the person's computer: McBot does not ship them.
 * A key is referenced as `${env:NAME}`, so it is saved in McBot and never written to the board.
 *
 * Remote entries (`url`) are hosted MCP servers that need no install and no key: free web search
 * for every agent from the first minute. Their addresses come from CopilotKit OpenBot's app
 * catalogue (MIT, server/src/plugins/catalogue.ts), where they ship keyless.
 */
import type { GraphNode } from "../../contracts/graph";
import { newId } from "./defaults";

export interface CatalogTool {
  id: string;
  label: string;
  /** One line: what an agent can do with it. */
  does: string;
  group: "Web" | "Work apps" | "Thinking" | "Your computer";
  /** The tool node's name (its `mcp_servers:` key; tools appear as mcp__<name>__*). */
  name: string;
  /** npx arguments for a local server; empty for a remote one. */
  args: string[];
  /** A hosted MCP server's address (streamable HTTP): no install, no key. */
  url?: string;
  /** The key it needs, by the variable the server reads (from its README). */
  key?: { env: string; where: string; optional?: boolean };
}

export const CATALOG: readonly CatalogTool[] = [
  { id: "exa", label: "Exa Search", does: "Searches the web and reads pages. Free, no key", group: "Web", name: "exa", args: [], url: "https://mcp.exa.ai/mcp" },
  { id: "parallel", label: "Parallel Search", does: "Web search with sources for research. Free, no key", group: "Web", name: "parallel", args: [], url: "https://search.parallel.ai/mcp" },
  { id: "browser", label: "Browser", does: "Opens pages, clicks, fills forms and reads them (Playwright)", group: "Web", name: "browser", args: ["-y", "@playwright/mcp@latest"] },
  { id: "brave", label: "Brave Search", does: "Searches the web and news", group: "Web", name: "brave", args: ["-y", "@brave/brave-search-mcp-server", "--transport", "stdio"], key: { env: "BRAVE_API_KEY", where: "api-dashboard.search.brave.com" } },
  { id: "tavily", label: "Tavily", does: "Web search and page extraction made for agents", group: "Web", name: "tavily", args: ["-y", "tavily-mcp"], key: { env: "TAVILY_API_KEY", where: "app.tavily.com" } },
  { id: "firecrawl", label: "Firecrawl", does: "Turns websites into clean text, crawls whole sites", group: "Web", name: "firecrawl", args: ["-y", "firecrawl-mcp"], key: { env: "FIRECRAWL_API_KEY", where: "firecrawl.dev" } },
  { id: "context7", label: "Context7", does: "Up-to-date docs for any code library", group: "Web", name: "context7", args: ["-y", "@upstash/context7-mcp"], key: { env: "CONTEXT7_API_KEY", where: "context7.com", optional: true } },
  { id: "notion", label: "Notion", does: "Reads and writes your Notion pages and databases", group: "Work apps", name: "notion", args: ["-y", "@notionhq/notion-mcp-server"], key: { env: "NOTION_TOKEN", where: "notion.so/my-integrations" } },
  { id: "memory", label: "Knowledge graph", does: "A shared memory of people, things and how they relate", group: "Thinking", name: "knowledge", args: ["-y", "@modelcontextprotocol/server-memory"] },
  { id: "thinking", label: "Step-by-step thinking", does: "Plans hard problems one step at a time", group: "Thinking", name: "thinking", args: ["-y", "@modelcontextprotocol/server-sequential-thinking"] },
];

export function catalogNode(t: CatalogTool, taken: ReadonlySet<string>, position: { x: number; y: number }): GraphNode {
  let name = t.name;
  for (let i = 2; taken.has(name); i++) name = `${t.name}-${i}`;
  return {
    id: newId("tool"), kind: "tool", position,
    data: t.url
      ? { name, label: t.label, transport: "http", command: "", args: [], env: {}, url: t.url, headers: {} }
      : { name, label: t.label, transport: "stdio", command: "npx", args: [...t.args], env: t.key ? { [t.key.env]: `\${env:${t.key.env}}` } : {}, url: "", headers: {} },
  };
}
