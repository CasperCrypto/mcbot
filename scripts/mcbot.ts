/**
 * `npm run mcbot -- …`: drive the running McBot from a terminal or a script (CI, cron, a git hook).
 * It talks to this computer's engine on loopback (MCBOT_PORT, default 4317), the same API the app
 * uses, so runs show up live in every McBot window, with their cost and memory.
 *
 *   npm run mcbot -- agents                          the agents on each board
 *   npm run mcbot -- run <agent> "<prompt>"          start a run, print its id
 *   npm run mcbot -- run <agent> - --wait < task.md  prompt from stdin, wait, print the answer
 *   npm run mcbot -- run <agent> "<prompt>" --wait --json   the finished run as JSON
 *   --board <id>   pick a board when two boards have an agent with that name
 *
 * Exit codes: 0 done, 1 the run failed or was cancelled, 2 a usage or engine problem.
 */
import { summarizeRun, type RunEvent, type RunSummary } from "../src/contracts/run";

const base = `http://127.0.0.1:${process.env.MCBOT_PORT ?? 4317}`;

class Problem extends Error {}

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, { method, headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new Problem(`McBot isn't running here (nothing answers at ${base}). Open McBot or run npm run dev.`);
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Problem(data.error ?? `${method} ${path}: ${res.status}`);
  return data;
}

interface Agent { boardId: string; board: string; nodeId: string; profile: string; name: string }

async function agents(): Promise<Agent[]> {
  const boards = await api<{ id: string; name: string }[]>("GET", "/api/boards");
  const out: Agent[] = [];
  for (const b of boards) {
    const mem = await api<{ profile: string; nodeId: string; displayName: string }[]>("GET", `/api/memory?boardId=${encodeURIComponent(b.id)}`);
    for (const a of mem) out.push({ boardId: b.id, board: b.name, nodeId: a.nodeId, profile: a.profile, name: a.displayName });
  }
  return out;
}

const stdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
};

async function waitFor(runId: string): Promise<RunSummary> {
  for (;;) {
    const events = await api<RunEvent[]>("GET", `/api/runs/${runId}`);
    const s = summarizeRun(events);
    if (s && s.status !== "running" && s.status !== "queued") return s;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function main(argv: string[]): Promise<number> {
  const flag = (name: string) => {
    const i = argv.indexOf(name);
    if (i < 0) return null;
    const v = argv[i + 1] ?? "";
    argv.splice(i, 2);
    return v;
  };
  const has = (name: string) => {
    const i = argv.indexOf(name);
    if (i >= 0) argv.splice(i, 1);
    return i >= 0;
  };
  const board = flag("--board");
  const wait = has("--wait");
  const json = has("--json");
  const [cmd, who, ...rest] = argv;

  if (cmd === "agents") {
    for (const a of await agents()) console.log(`${a.profile.padEnd(20)} ${a.name.padEnd(22)} ${a.board} (${a.boardId})`);
    return 0;
  }
  if (cmd === "run" && who) {
    let prompt = rest.join(" ");
    if (prompt === "-" || (!prompt && !process.stdin.isTTY)) prompt = await stdin();
    if (!prompt.trim()) throw new Problem("Say what the agent should do: npm run mcbot -- run <agent> \"<prompt>\"");
    const all = (await agents()).filter((a) => (a.profile === who || a.name.toLowerCase() === who.toLowerCase()) && (!board || a.boardId === board));
    if (all.length === 0) throw new Problem(`No agent called ${who}. See npm run mcbot -- agents`);
    if (all.length > 1) throw new Problem(`${who} is on ${all.length} boards (${all.map((a) => a.boardId).join(", ")}). Add --board <id>.`);
    const a = all[0]!;
    const { runId } = await api<{ runId: string }>("POST", "/api/runs", { boardId: a.boardId, agentNodeId: a.nodeId, prompt: prompt.trim() });
    if (!wait) {
      console.log(json ? JSON.stringify({ runId }) : runId);
      return 0;
    }
    const done = await waitFor(runId);
    if (json) console.log(JSON.stringify(done));
    else if (done.status === "succeeded") console.log(done.text.trim());
    else console.error(`${a.profile} ${done.status}: ${done.error ?? "see Activity in McBot"}`);
    return done.status === "succeeded" ? 0 : 1;
  }
  console.error("Usage: npm run mcbot -- agents | run <agent> \"<prompt>\" [--wait] [--json] [--board <id>]");
  return 2;
}

main(process.argv.slice(2)).then((code) => process.exit(code)).catch((err: unknown) => {
  console.error(err instanceof Problem ? err.message : err);
  process.exit(2);
});
