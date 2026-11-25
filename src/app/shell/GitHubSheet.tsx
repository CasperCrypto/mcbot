/**
 * Add from GitHub: paste (or drop, or type in ⌘K) a repository link, and McBot says what it is
 * (engine/github.ts) and puts it to use in one step: a skill an agent learns, an MCP server as a
 * tool block wired to an agent, a Hermes plugin installed for an agent, or a project downloaded into
 * the shared files folder. Any of them can also go to an agent as a question.
 */
import { ArrowRight, BookOpen, Download, ExternalLink, FolderGit2, MessageSquare, Plug, Puzzle, Scale, Star, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { addEdge, addNode } from "../../board/ydoc";
import type { GitHubRepoView } from "../../contracts/api";
import type { AgentNode } from "../../contracts/graph";
import { runAgent } from "../actions";
import { newId, uniqueName } from "../graph/defaults";
import { LogoTile } from "../graph/Logo";
import { freeSpot } from "../graph/place";
import { DEMO, engine, REMOTE } from "../lib/engine";
import { LOGOS } from "../lib/logos.generated";
import { openExternal } from "../lib/open";
import { usePresence } from "../lib/presence";
import { useBoard } from "../state/board";
import { useApp } from "../state/store";
import { Picker } from "../Picker";
import { agentOptions } from "../lib/agentOptions";

/** A GitHub repository link in some text, or null. */
export const githubLink = (text: string): string | null => /(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+[^\s"'<>)]*/i.exec(text.trim())?.[0] ?? null;

const KIND: Record<GitHubRepoView["kind"], { label: string; icon: ReactNode; what: string }> = {
  skill: { label: "Skill", icon: <BookOpen size={13} />, what: "An agent learns it" },
  mcp: { label: "MCP server", icon: <Plug size={13} />, what: "A tool an agent can use" },
  plugin: { label: "Hermes plugin", icon: <Puzzle size={13} />, what: "Adds to what an agent can do" },
  project: { label: "Project", icon: <FolderGit2 size={13} />, what: "Code or files to work on" },
};

/** Paste or drop a GitHub link anywhere outside a text field: Add from GitHub opens with it. */
export function useGitHubDrops(): void {
  useEffect(() => {
    if (REMOTE || DEMO) return;
    const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    const onPaste = (e: ClipboardEvent) => {
      if (typing(e.target)) return;
      const link = githubLink(e.clipboardData?.getData("text") ?? "");
      if (link) useApp.getState().setGithub(link);
    };
    const onDrop = (e: DragEvent) => {
      const link = githubLink(e.dataTransfer?.getData("text/uri-list") || e.dataTransfer?.getData("text/plain") || "");
      if (!link) return;
      e.preventDefault();
      useApp.getState().setGithub(link);
    };
    const onOver = (e: DragEvent) => { if (e.dataTransfer?.types.includes("text/uri-list")) e.preventDefault(); };
    window.addEventListener("paste", onPaste);
    window.addEventListener("drop", onDrop);
    window.addEventListener("dragover", onOver);
    return () => {
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("dragover", onOver);
    };
  }, []);
}

export function GitHubSheet() {
  const opened = useApp((s) => s.github);
  const setGithub = useApp((s) => s.setGithub);
  const toast = useApp((s) => s.toast);
  const { doc, graph, boardId } = useBoard();
  const agents = useMemo(() => graph.nodes.filter((n): n is AgentNode => n.kind === "agent"), [graph]);
  const [link, setLink] = useState("");
  const [repo, setRepo] = useState<GitHubRepoView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [agentId, setAgentId] = useState("");
  const open = opened !== null;
  const presence = usePresence(open);
  const agent = agents.find((a) => a.id === agentId) ?? agents[0];

  const inspect = (url: string) => {
    if (!url.trim()) return;
    setRepo(null);
    setProblem(null);
    setBusy("read");
    engine.githubInspect(url.trim()).then(setRepo).catch((e: Error) => setProblem(e.message)).finally(() => setBusy(null));
  };
  useEffect(() => {
    if (opened === null) return;
    setLink(opened);
    setRepo(null);
    setProblem(null);
    if (opened) inspect(opened);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setGithub(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [opened]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!presence.mounted) return null;
  const name = agent ? agent.data.displayName || agent.data.name : "";
  const done = (text: string, action?: { label: string; run: () => void }) => {
    setGithub(null);
    toast({ kind: "ok", text, action });
  };
  const act = async (what: string, f: () => Promise<void>) => {
    setBusy(what);
    try {
      await f();
    } catch (e) {
      toast({ kind: "fail", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };
  const use = () => repo && agent && act("use", async () => {
    if (repo.kind === "skill") {
      await engine.addSkill(agent.data.name, repo.source);
      done(`${name} learned ${repo.repo}`);
    } else if (repo.kind === "plugin") {
      await engine.githubPlugin(agent.data.name, repo.source);
      done(`${repo.repo} installed for ${name}`);
    } else if (repo.kind === "mcp" && repo.mcp) {
      const taken = graph.nodes.filter((n) => n.kind === "tool").map((n) => String(n.data.name));
      const node = {
        id: newId("tool"), kind: "tool" as const, position: freeSpot(graph, "tool", agent.position, agent.id),
        data: { name: uniqueName(repo.mcp.name, taken), label: repo.repo, transport: "stdio" as const, command: repo.mcp.command, args: repo.mcp.args, env: {}, url: "", headers: {} },
      };
      doc.transact(() => {
        addNode(doc, node);
        addEdge(doc, { id: newId("edge"), source: agent.id, target: node.id, order: 0 });
      });
      done(`${repo.repo} added to ${name}. Compile to use it.`, { label: "Show", run: () => { useApp.getState().setTab("graph"); useApp.getState().select(node.id); } });
    } else {
      const r = await engine.githubDownload(repo.url);
      done(`${repo.repo} is in your shared files, in ${r.folder}`, { label: "Open", run: () => useApp.getState().setTab("files") });
    }
  });
  const ask = () => repo && agent && act("ask", async () => {
    const runId = await runAgent(boardId, agent.id, `Look at this GitHub repository: ${repo.url}\n${repo.description ? `(${repo.description})\n` : ""}Tell me what it does and how we could use it here.`);
    if (runId) {
      setGithub(null);
      useApp.getState().openChat(agent.id);
    }
  });
  const label = !repo ? "" : repo.kind === "skill" ? `Teach ${name}` : repo.kind === "plugin" ? `Install for ${name}` : repo.kind === "mcp" ? `Add to ${name}` : "Download to Files";
  const needsAgent = repo?.kind !== "project";
  const githubMark = LOGOS.github ?? null;

  return (
    <>
      <div data-closing={presence.closing || undefined} className="palette-scrim" onClick={() => setGithub(null)} />
      <section className="palette hermes-sheet github-sheet" role="dialog" aria-modal="true" aria-label="Add from GitHub" data-closing={presence.closing || undefined} data-testid="github-sheet">
        <header>
          <span className="hermes-mark" aria-hidden>{githubMark ? <LogoTile logo={githubMark} kind="tool"><FolderGit2 size={16} /></LogoTile> : <FolderGit2 size={18} />}</span>
          <div className="grow">
            <h2>Add from GitHub</h2>
            <small>Skills, MCP servers, Hermes plugins or any project</small>
          </div>
          <button className="icon-btn" aria-label="Close" onClick={() => setGithub(null)}><X size={15} /></button>
        </header>
        <div className="share-body">
          <form className="gh-link" onSubmit={(e) => { e.preventDefault(); inspect(link); }}>
            <input className="mono" value={link} onChange={(e) => setLink(e.target.value)} placeholder="github.com/owner/repo" autoFocus spellCheck={false} aria-label="GitHub link" data-testid="github-link"
              onPaste={(e) => { const l = githubLink(e.clipboardData.getData("text")); if (l) { e.preventDefault(); setLink(l); inspect(l); } }} />
            <button className="btn primary" disabled={!link.trim() || busy === "read"}>{busy === "read" ? "Reading…" : "Read"} <ArrowRight size={13} /></button>
          </form>
          {problem && <p className="error" style={{ margin: 0 }}>{problem}</p>}
          {busy === "read" && !repo && <div className="skeleton" style={{ height: 112 }} />}
          {repo && (
            <article className="gh-card" data-testid="github-repo">
              <div className="gh-title">
                <b>{repo.owner}/{repo.repo}</b>{repo.path && <span className="faint">/{repo.path}</span>}
                <span className={`gh-kind ${repo.kind}`} data-tip={KIND[repo.kind].what}>{KIND[repo.kind].icon}{KIND[repo.kind].label}</span>
              </div>
              {repo.description && <p>{repo.description}</p>}
              <div className="gh-meta">
                <span><Star size={12} /> {repo.stars.toLocaleString()}</span>
                {repo.language && <span>{repo.language}</span>}
                <span data-tip={repo.license ? undefined : "No licence: ask before you use its code"}><Scale size={12} /> {repo.license ?? "No licence"}</span>
                <button className="link-btn" onClick={() => void openExternal(repo.url)}><ExternalLink size={12} /> GitHub</button>
              </div>
              {repo.mcp && <code className="gh-cmd mono">{[repo.mcp.command, ...repo.mcp.args].join(" ")}</code>}
              <div className="gh-actions">
                {(needsAgent || agents.length > 0) && (agents.length ? (
                  <Picker label="Agent" value={agent!.id} onChange={setAgentId} options={agentOptions(agents)} testId="gh-agent" />
                ) : <span className="faint">Add an agent first.</span>)}
                <span className="grow" />
                {agents.length > 0 && <button className="btn" disabled={!!busy} onClick={() => void ask()}><MessageSquare size={13} /> Ask about it</button>}
                <button className="btn primary" disabled={!!busy || (needsAgent && !agent)} onClick={() => void use()} data-testid="github-use">
                  {repo.kind === "project" ? <Download size={13} /> : KIND[repo.kind].icon} {busy === "use" ? "Working…" : label}
                </button>
              </div>
            </article>
          )}
          {!repo && !busy && !problem && <p className="faint gh-hint">Paste a link here, or anywhere in McBot. A skill, an MCP server or a plugin goes straight to an agent.</p>}
        </div>
      </section>
    </>
  );
}
