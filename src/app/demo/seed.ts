/**
 * What the browser demo starts with: one board, sample files and a few days
 * of history. Everything here is sample data, generated in the page.
 */
import type { Graph } from "../../contracts/graph";

export const HOME = "/Users/you";
export const WORKSPACE = `${HOME}/McBot`;
export const ROOT = `${WORKSPACE}/hermes`;
export const SEED_BOARD = { id: "support-desk", name: "Support desk" };

export const seedGraph: Graph = {
  schema: "mcbot.graph/v1",
  id: SEED_BOARD.id,
  name: SEED_BOARD.name,
  nodes: [
    {
      id: "agent-triage", kind: "agent", position: { x: 0, y: 0 },
      data: {
        name: "triage", displayName: "Triage desk", description: "Reads incoming tickets and routes them.",
        soul: "You are the first reader of every support ticket.\nRoute billing to Sam, outages to the on-call, everything else to the researcher.\nKeep replies short.",
        skills: [{
          name: "route-ticket", description: "Pick the owner for a support ticket.", version: "1.0.0", author: "Support", license: "MIT",
          platforms: [], tags: ["support"], body: "# Route a ticket\n\n1. Read the ticket.\n2. Billing → Sam. Outage → on-call. Else → researcher.\n3. Reply with the owner and one line why.",
        }],
        capabilities: null,
      },
    },
    {
      id: "agent-research", kind: "agent", position: { x: 0, y: 250 },
      data: {
        name: "researcher", displayName: "Researcher", description: "Answers product questions from the docs.",
        soul: "You answer product questions from Acme's docs.\nQuote the doc you used.", skills: [], capabilities: null,
      },
    },
    {
      id: "model-local", kind: "model", position: { x: -380, y: 10 },
      data: { name: "local", label: "Local model", endpoint: "local", baseUrl: "http://127.0.0.1:11434/v1", model: "qwen3:8b", apiKeyEnv: "", pricing: null },
    },
    {
      id: "model-cloud", kind: "model", position: { x: -380, y: 230 },
      data: {
        name: "cloud", label: "Cloud model", endpoint: "cloud", baseUrl: "https://openrouter.ai/api/v1", model: "anthropic/claude-sonnet-4.5",
        apiKeyEnv: "OPENROUTER_API_KEY", pricing: { inputPerMTok: 3, outputPerMTok: 15 },
      },
    },
    {
      id: "tool-files", kind: "tool", position: { x: 380, y: 30 },
      data: {
        name: "files", label: "Shared files", transport: "stdio", command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", `${WORKSPACE}/files`], env: {}, url: "", headers: {},
      },
    },
    {
      id: "tool-docs", kind: "tool", position: { x: 380, y: 270 },
      data: { name: "docs", label: "Docs search", transport: "http", command: "", args: [], env: {}, url: "https://mcp.example.com/docs", headers: {} },
    },
  ],
  edges: [
    { id: "e-local-triage", source: "model-local", target: "agent-triage", order: 0 },
    { id: "e-cloud-triage", source: "model-cloud", target: "agent-triage", order: 1 },
    { id: "e-cloud-research", source: "model-cloud", target: "agent-research", order: 0 },
    { id: "e-triage-files", source: "agent-triage", target: "tool-files", order: 0 },
    { id: "e-research-files", source: "agent-research", target: "tool-files", order: 0 },
    { id: "e-research-docs", source: "agent-research", target: "tool-docs", order: 0 },
    { id: "e-triage-research", source: "agent-triage", target: "agent-research", order: 0 },
  ],
  messages: [
    { id: "msg-seed-1", author: "Sam", color: "#30d158", agent: "", text: "Morning! Billing tickets doubled overnight. Can we have triage route them straight to me?", at: Date.UTC(2026, 10, 12, 8, 2) },
    { id: "msg-seed-2", author: "Lee", color: "#bf5af2", agent: "", text: "@triage how many billing tickets came in since yesterday?", at: Date.UTC(2026, 10, 12, 8, 4) },
    { id: "msg-seed-3", author: "Triage desk", color: "", agent: "triage", text: "7 billing tickets since yesterday 6 pm. 5 are double charges (4471 and 4 more), 2 are refund requests. All routed to Sam.", at: Date.UTC(2026, 10, 12, 8, 4, 40) },
  ],
};

export const seedMemory: Record<string, { memory: string[]; user: string[] }> = {
  triage: {
    memory: ["Billing tickets go to Sam; outages page the on-call.", "Acme's SLA: first reply within 4 hours."],
    user: ["Maya runs support and prefers short answers."],
  },
  researcher: { memory: ["Product docs live in ~/Projects/acme-support/docs."], user: [] },
};

/** [profile, prompt, days ago, hour UTC] — replayed through the demo runner at first load. */
export const seedRuns: [string, string, number, number][] = [
  ["triage", "Customer says invoice #4471 charged them twice.", 6, 9],
  ["researcher", "How does ticket routing work?", 6, 11],
  ["triage", "Status page shows EU latency, three tickets in a row.", 5, 14],
  ["researcher", "What is our SLA for first replies?", 4, 10],
  ["triage", "call:mcp__files__list_directory {\"path\": \"tickets\"}", 4, 15],
  ["researcher", "Summarise docs/routing.md for a new hire.", 3, 9],
  ["triage", "Who handles a refund request?", 2, 13],
  ["researcher", "Can a customer export their data?", 1, 10],
  ["triage", "what is 2+2", 0, 8],
];

export const sharedFiles: Record<string, string> = {
  "readme.txt": "Files every agent on this board can read.\n",
  "escalation.md": "# Escalation\n\n- Billing: Sam\n- Outage: on-call (pager)\n- Everything else: researcher\n",
  "tickets/4471-double-charge.md": "Invoice #4471 was charged twice on 3 Nov.\nCustomer: Northwind.\n",
  "tickets/4472-eu-latency.md": "EU dashboard loads in 9s since 07:40 UTC.\n",
  "tickets/4473-data-export.md": "Can we export all tickets as CSV?\n",
};

export const sampleProject: Record<string, string> = {
  "README.md": "# acme-support\n\nTicket router for Acme's support inbox.\n",
  "package.json": "{\n  \"name\": \"acme-support\",\n  \"version\": \"0.4.0\",\n  \"type\": \"module\"\n}\n",
  "src/index.ts": "import { route } from \"./router\";\n\nexport { route };\n",
  "src/router.ts": "export function route(ticket: { subject: string }): string {\n  if (/invoice|refund|charge/i.test(ticket.subject)) return \"billing\";\n  if (/down|latency|outage/i.test(ticket.subject)) return \"on-call\";\n  return \"researcher\";\n}\n",
  "src/handlers/billing.ts": "export const owner = \"sam\";\n",
  "src/handlers/outage.ts": "export const owner = \"on-call\";\n",
  "docs/routing.md": "# Routing\n\nBilling goes to Sam. Outages page the on-call. Everything else goes to the researcher.\n",
  "docs/sla.md": "# SLA\n\nFirst reply within 4 hours, resolution within 2 business days.\n",
  "docs/export.md": "# Export\n\nAdmins can export tickets as CSV from Settings → Data.\n",
  "tests/router.test.ts": "import { route } from \"../src/router\";\n\nroute({ subject: \"Refund please\" });\n",
};
