import {
  BookOpen, Bot, FileCode2, History, Stethoscope, Redo2, Undo2, KeyRound, Settings, Brain, Code2, Globe, House, ListChecks, Cpu, Send, ChartColumnBig, Cloud, CornerDownLeft, Download, FolderOpen, FolderPlus, Hammer, HardDrive, Layers, LifeBuoy, MessagesSquare, Plug, Plus, RotateCcw, Search, Server, Sparkles, Upload, Users, Waypoints, Workflow,
} from "lucide-react";
import { redo, undo } from "../../board/undo";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { addEdge, addNode } from "../../board/ydoc";
import type { GraphNode } from "../../contracts/graph";
import { compileBoard, exportBoardFile, importBoardFile, openHermesSetup, runAgent } from "../actions";
import { newChannel, newId, newModel, newTool, newVault } from "../graph/defaults";
import { freeSpot } from "../graph/place";
import { resetDemo } from "../demo/engine";
import { DEMO, engine } from "../lib/engine";
import { useBoard } from "../state/board";
import { useApp, type Tab } from "../state/store";
import { AgentFace, Kbd } from "../ui";
import { searchRuns } from "../lib/search";
import { frecency, fuzzyScore, loadRecent, recordUse } from "../lib/rank";
import { usePresence } from "../lib/presence";

interface Command {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: ReactNode;
  keys?: string[];
  run?: () => void;
  /** More things to do with it, in the actions panel (⌘K on a row, as in Raycast). */
  actions?: { label: string; icon?: ReactNode; run: () => void }[];
  /** Selecting it asks for one line of input first (Raycast-style). */
  ask?: { placeholder: string; submit: (value: string) => Promise<void> | void };
}

/**
 * The rail, in four groups: core (Home, Board, Chat), the agents' work (Tasks, Runs, Skills),
 * the workbench (Code, Browser, Files) and insight (Memory, Cost, Team). ⌘1–9 follow this order.
 */
export const VIEWS: { tab: Tab; label: string; icon: ReactNode; group: number; tip?: string }[] = [
  { tab: "home", label: "Home", icon: <House size={15} />, group: 0 },
  { tab: "graph", label: "Board", icon: <Waypoints size={15} />, group: 0, tip: "Design the harness" },
  { tab: "agents", label: "Chat", icon: <MessagesSquare size={15} />, group: 0, tip: "Talk to your agents" },
  { tab: "tasks", label: "Tasks", icon: <ListChecks size={15} />, group: 1 },
  { tab: "workflows", label: "Runs", icon: <History size={15} />, group: 1 },
  { tab: "skills", label: "Skills", icon: <Sparkles size={15} />, group: 1, tip: "Skills and plugins" },
  { tab: "code", label: "Code", icon: <Code2 size={15} />, group: 2 },
  { tab: "browser", label: "Browser", icon: <Globe size={15} />, group: 2 },
  { tab: "files", label: "Files", icon: <FolderOpen size={15} />, group: 2 },
  { tab: "memory", label: "Memory", icon: <Brain size={15} />, group: 3 },
  { tab: "cost", label: "Cost", icon: <ChartColumnBig size={15} />, group: 3 },
  { tab: "team", label: "Team", icon: <Users size={15} />, group: 3 },
];

function useCommands(close: () => void): Command[] {
  const { graph, doc, boardId } = useBoard();
  const app = useApp();
  return useMemo(() => {
    const place = (node: GraphNode) => {
      addNode(doc, node);
      app.setTab("graph");
      app.select(node.id);
      close();
    };
    const at = (kind: GraphNode["kind"]) => freeSpot(graph, kind, null, app.selectedNodeId);
    const cmds: Command[] = [
      { id: "add-agent", group: "Create", label: "Agent", hint: "Name it, say what it does", icon: <Bot size={15} />, run: () => app.setNewAgentOpen(true) },
      { id: "add-task", group: "Create", label: "Task", hint: "Give an agent something to do", icon: <ListChecks size={15} />, run: () => app.showTask("new") },
      { id: "add-local", group: "Create", label: "Local model", hint: "Ollama, LM Studio, vLLM…", icon: <HardDrive size={15} />, run: () => place(newModel(graph, "local", at("model"))) },
      { id: "add-cloud", group: "Create", label: "Cloud model", hint: "Any OpenAI-compatible API", icon: <Cloud size={15} />, run: () => place(newModel(graph, "cloud", at("model"))) },
      { id: "add-files", group: "Create", label: "Files tool", icon: <Plug size={15} />, run: () => place(newTool(graph, "filesystem", at("tool"), app.health?.workspace ?? null)) },
      { id: "share", group: "Actions", label: "Invite teammates…", hint: "Copy a link, email it", icon: <Users size={15} />, run: () => app.setShareOpen(true) },
      { id: "ask-mcbot", group: "Create", label: "Ask McBot to build…", hint: "Describe the agents you need; review, then add", icon: <Sparkles size={15} />, run: () => app.setBuilder(true) },
      { id: "add-team", group: "Create", label: "Team…", hint: "Research & write, Support desk, Dev team…", icon: <Users size={15} />, run: () => app.setTeamsOpen(true) },
      { id: "add-tool-catalog", group: "Create", label: "Tool…", hint: "Browser, web search, Notion…", icon: <Plug size={15} />, run: () => app.setCatalogOpen(true) },
      { id: "add-mcp", group: "Create", label: "MCP server", icon: <Server size={15} />, run: () => place(newTool(graph, "stdio", at("tool"), null)) },
      { id: "add-telegram", group: "Create", label: "Telegram bot", hint: "Talk to an agent from Telegram", icon: <Send size={15} />, run: () => place(newChannel(graph, "telegram", at("channel"))) },
      { id: "add-chat-app", group: "Create", label: "Chat app…", hint: "Slack, Discord, WhatsApp, Teams, email and more", icon: <MessagesSquare size={15} />, run: () => useApp.getState().setChatAppsOpen(true) },
      {
        id: "add-vault", group: "Create", label: "Obsidian vault…", hint: "Agents read and write your notes", icon: <BookOpen size={15} />,
        ask: {
          placeholder: "/Users/you/Documents/Obsidian Vault",
          submit: async (folder) => {
            const vault = newVault(graph, folder, at("tool"));
            const agent = graph.nodes.find((n) => n.id === app.selectedNodeId && n.kind === "agent");
            doc.transact(() => {
              addNode(doc, vault);
              if (agent) addEdge(doc, { id: newId("edge"), source: agent.id, target: vault.id, order: 0 });
            });
            // Also browse it in Files; a folder the engine cannot see is still fine on the board.
            await engine.openFolder(folder.trim()).catch(() => undefined);
            app.setTab("graph");
            app.select(vault.id);
            close();
          },
        },
      },
      { id: "undo", group: "Actions", label: "Undo", hint: "Your last change to the board", icon: <Undo2 size={15} />, keys: ["⌘", "Z"], run: () => { close(); if (!undo(doc)) app.toast({ kind: "ok", text: "Nothing to undo" }); } },
      { id: "redo", group: "Actions", label: "Redo", icon: <Redo2 size={15} />, keys: ["⇧", "⌘", "Z"], run: () => { close(); if (!redo(doc)) app.toast({ kind: "ok", text: "Nothing to redo" }); } },
      { id: "doctor", group: "Actions", label: "Check the harness", hint: "Models, keys, wires, budgets, files: what's wrong and the fix", icon: <Stethoscope size={15} />, run: () => { close(); app.setDoctorOpen(true); } },
      { id: "compile", group: "Actions", label: "Compile", icon: <Hammer size={15} />, keys: ["⌘", "S"], run: () => { close(); void compileBoard(boardId); } },
      { id: "live-files", group: "Actions", label: "Live files", hint: "Watch the files this board writes change as you edit", icon: <FileCode2 size={15} />, run: () => { close(); app.setTab("graph"); app.setLiveFilesOpen(!useApp.getState().liveFilesOpen); } },
      { id: "compile-files", group: "Actions", label: "Compiled files", hint: "What the last compile wrote, file by file", icon: <FolderOpen size={15} />, run: () => { close(); app.setTab("graph"); app.setCompile({ compileOpen: true }); } },
      { id: "open-folder", group: "Actions", label: "Open folder…", hint: "Pick a folder for agents and the editor", icon: <FolderPlus size={15} />, run: () => app.setFolderPickerOpen(true) },
      {
        id: "new-board", group: "Actions", label: "New board…", icon: <Plus size={15} />,
        ask: {
          placeholder: "Board name",
          submit: async (name) => {
            const b = await engine.createBoard(name.trim() || "Untitled");
            app.setBoards(await engine.boards());
            app.setBoard(b.id);
            close();
          },
        },
      },
      { id: "export-board", group: "Actions", label: "Export board", hint: "Save it as a file", icon: <Download size={15} />, run: () => { close(); void exportBoardFile(boardId); } },
      { id: "open-hermes", group: "Actions", label: "Open my Hermes setup", hint: "Draw ~/.hermes as a board", icon: <FolderOpen size={15} />, run: () => { close(); void openHermesSetup(); } },
      { id: "import-board", group: "Actions", label: "Import board…", hint: "Open a board file", icon: <Upload size={15} />, run: () => { close(); importBoardFile(); } },
      { id: "settings", group: "Actions", label: "Settings", hint: "Models, API keys, your name, team", icon: <Settings size={15} />, keys: ["⌘", ","], run: () => app.openSettings() },
      { id: "models", group: "Actions", label: "Add a model…", hint: "Ollama, LM Studio, OpenAI, OpenRouter…", icon: <Sparkles size={15} />, run: () => app.openSettings("models") },
      { id: "keys", group: "Actions", label: "API keys", icon: <KeyRound size={15} />, run: () => app.openSettings("keys") },
      { id: "hermes", group: "Actions", label: "Engine", hint: "Status and restart", icon: <Cpu size={15} />, run: () => app.setHermesOpen(true) },
      { id: "report", group: "Actions", label: "Report a problem…", hint: "Details to paste into an issue", icon: <LifeBuoy size={15} />, run: () => app.setReportOpen(true) },
      { id: "setup", group: "Actions", label: "Set up a new team…", hint: "Run the setup assistant again", icon: <Sparkles size={15} />, run: () => { close(); app.setSetup({ completed: false, profile: app.setup?.profile ?? null }); } },
      ...(DEMO ? [{ id: "reset-demo", group: "Actions", label: "Reset demo", hint: "Start over with the sample board", icon: <RotateCcw size={15} />, run: resetDemo }] : []),
      ...VIEWS.map((v, i) => ({ id: `go-${v.tab}`, group: "Go to", label: v.label, hint: v.tip, icon: v.icon, keys: i < 9 ? ["⌘", String(i + 1)] : undefined, run: () => { app.setTab(v.tab); close(); } })),
      // Ask an agent straight from ⌘K (and so from anywhere, with the launcher shortcut).
      ...graph.nodes.filter((n) => n.kind === "agent").map((n): Command => ({
        id: `ask-${n.id}`, group: "Agents", label: `Ask ${n.data.displayName || n.data.name}…`, hint: `@${n.data.name}`,
        icon: <AgentFace seed={n.data.name} size={22} />,
        ask: {
          placeholder: `What should ${n.data.displayName || n.data.name} do?`,
          submit: async (prompt) => {
            if (!prompt.trim()) return;
            close();
            app.openChat(n.id);
            await runAgent(boardId, n.id, prompt.trim());
          },
        },
      })),
      ...graph.nodes.filter((n) => n.kind === "agent").map((n) => ({
        id: `chat-${n.id}`, group: "Agents", label: n.data.displayName || n.data.name, hint: "Open the chat",
        icon: <AgentFace seed={n.data.name} size={22} />, run: () => { app.openChat(n.id); close(); },
        actions: [
          { label: "Show on the board", icon: <Waypoints size={14} />, run: () => { app.setTab("graph"); app.select(n.id); close(); } },
          { label: "Open its files", icon: <FolderOpen size={14} />, run: () => { app.setTab("files"); app.select(n.id); close(); } },
        ],
      })),
      ...app.boards.filter((b) => b.id !== boardId).map((b) => ({ id: `board-${b.id}`, group: "Boards", label: b.name || b.id, icon: <Layers size={15} />, run: () => { app.setBoard(b.id); close(); } })),
    ];
    return cmds;
  }, [graph, doc, boardId, app, close]);
}

const TAGS: Record<string, string> = { Create: "Create", Actions: "Command", "Go to": "Go to", Agents: "Agent", Boards: "Board", Conversations: "Conversation", Ask: "Ask" };
const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform || navigator.userAgent);
const MOD = isMac ? "⌘" : "Ctrl";

/** How well a command fits what was typed: its name counts most, then its hint and group. 0 = no match. */
function score(c: Command, q: string): number {
  const name = fuzzyScore(q, c.label);
  const rest = fuzzyScore(q, `${c.label} ${c.hint ?? ""} ${c.group}`, false);
  return name ? name * 3 + rest : rest;
}

export function Palette() {
  const open = useApp((s) => s.paletteOpen);
  const setPalette = useApp((s) => s.setPalette);
  // Stays a moment after closing, to leave the way it came (lib/presence.ts).
  const presence = usePresence(open);
  if (!presence.mounted) return null;
  return <PaletteBody close={() => setPalette(false)} closing={presence.closing} />;
}

function PaletteBody({ close, closing }: { close: () => void; closing: boolean }) {
  const commands = useCommands(close);
  const runs = useApp((s) => s.runs);
  const { graph, boardId } = useBoard();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [asking, setAsking] = useState<Command | null>(null);
  const [panel, setPanel] = useState(false);
  const [pi, setPi] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const recent = useMemo(() => loadRecent(), []);
  const selectedId = useApp((s) => s.selectedNodeId);
  // Typing ranks by fit and by how often you use a command; empty shows what you use most first.
  // Each group is listed once, in the order its best hit appears.
  const shown = useMemo(() => {
    if (asking) return [];
    const q = query.trim();
    const use = (c: Command) => frecency(recent[c.id]);
    const ranked = q
      ? commands.map((c) => ({ c, s: score(c, q) })).filter((x) => x.s > 0).sort((a, b) => b.s + use(b.c) * 8 - (a.s + use(a.c) * 8)).map((x) => x.c)
      : commands;
    const top = q ? [] : commands.filter((c) => use(c) > 0.6 && !c.id.startsWith("go-")).sort((a, b) => use(b) - use(a)).slice(0, 4).map((c) => ({ ...c, group: "Suggested" }));
    const rest = q ? ranked : ranked.filter((c) => !top.some((t) => t.id === c.id));
    const order = [...new Set(rest.map((c) => c.group))];
    const nameOf = (id: string) => {
      const a = graph.nodes.find((n) => n.id === id);
      return a?.kind === "agent" ? a.data.displayName || a.data.name : "";
    };
    const said: Command[] = searchRuns(Object.values(runs), query).map(({ run, snippet }) => ({
      id: `run-${run.runId}`, group: "Conversations", label: run.prompt.split("\n")[0]!.slice(0, 80), hint: `${nameOf(run.agentNodeId) || run.profile} · ${snippet}`,
      icon: <AgentFace seed={run.profile} size={22} status={run.status} />,
      run: () => { useApp.getState().selectRun(run.runId); useApp.getState().openChat(run.agentNodeId); close(); },
      actions: [{ label: "Show on the board", icon: <Waypoints size={14} />, run: () => { useApp.getState().setTab("graph"); useApp.getState().select(run.agentNodeId); close(); } }],
    }));
    // Nothing fits? Ask an agent, like Raycast's "Ask AI": the selected agent, else the first.
    const agents = graph.nodes.filter((n) => n.kind === "agent");
    const target = agents.find((n) => n.id === selectedId) ?? agents[0];
    const fallback: Command[] = q.length >= 3 && target ? [{
      id: `ask-fallback`, group: "Ask", label: `Ask ${target.data.displayName || target.data.name}`, hint: `“${q.slice(0, 80)}”`,
      icon: <AgentFace seed={target.data.name} size={22} />,
      run: () => { close(); useApp.getState().openChat(target.id); void runAgent(boardId, target.id, q); },
    }] : [];
    // …or have McBot design agents for it.
    if (q.length >= 8) fallback.push({ id: "build-fallback", group: "Ask", label: "Ask McBot to build this", hint: `“${q.slice(0, 80)}”`, icon: <Sparkles size={15} />, run: () => { close(); useApp.getState().setBuilder(true, q); } });
    return [...top, ...order.flatMap((g) => rest.filter((c) => c.group === g)), ...said, ...fallback];
  }, [commands, query, asking, runs, graph, close, recent, selectedId, boardId]);
  // Block bodies on purpose: scrollIntoView returns a Promise in current Chromium,
  // and an effect that returns a non-function crashes React on cleanup.
  useEffect(() => {
    setIndex(0);
    setPanel(false);
  }, [query, asking]);
  useEffect(() => {
    input.current?.focus();
  }, [asking]);
  useEffect(() => {
    void list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [index]);

  const choose = (c: Command | undefined) => {
    if (!c) return;
    if (c.id !== "ask-fallback" && c.id !== "build-fallback") recordUse(c.id);
    if (c.ask) {
      setAsking(c);
      setQuery("");
    } else c.run?.();
  };
  const current = shown[index];
  const extras = current?.actions ?? [];
  const onKey = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      // ⌘K inside the palette opens what else you can do with the row (the window's ⌘K stays out of it).
      e.preventDefault();
      e.stopPropagation();
      if (!asking && extras.length) { setPanel((v) => !v); setPi(0); }
      return;
    }
    if (panel) {
      if (e.key === "Escape") { e.preventDefault(); setPanel(false); }
      else if (e.key === "ArrowDown") { e.preventDefault(); setPi((i) => Math.min(extras.length - 1, i + 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setPi((i) => Math.max(0, i - 1)); }
      else if (e.key === "Enter") { e.preventDefault(); if (current) recordUse(current.id); extras[pi]?.run(); }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      if (asking) setAsking(null);
      else close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => Math.min(shown.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "Tab" && !asking && current?.ask) {
      e.preventDefault();
      choose(current);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (asking) {
        if (query.trim()) void asking.ask!.submit(query);
      } else choose(current);
    }
  };

  let lastGroup = "";
  return (
    <>
      <div data-closing={closing || undefined} className="palette-scrim" onClick={close} />
      <div className="palette" role="dialog" aria-modal="true" data-closing={closing || undefined} aria-label="Command palette" data-testid="palette">
        <div className="palette-input">
          {asking ? <span className="chip accent">{asking.label.replace("…", "")}</span> : <Search size={18} className="faint" />}
          <input ref={input} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKey}
            placeholder={asking ? asking.ask!.placeholder : "Search commands and conversations"} spellCheck={false} aria-label="Command" />
        </div>
        {!asking && (
          <div className="palette-list" ref={list} role="listbox">
            {shown.length === 0 && <div className="palette-group">No results</div>}
            {shown.map((c, i) => {
              const head = c.group !== lastGroup ? <div className="palette-group">{(lastGroup = c.group)}</div> : null;
              return (
                <div key={`${c.group}-${c.id}`}>
                  {head}
                  <button className="palette-row" role="option" data-group={c.group} aria-selected={i === index} onMouseMove={() => setIndex(i)} onClick={() => choose(c)}>
                    <span className="tile">{c.icon}</span>
                    <span className="label">{c.label}</span>
                    {c.hint && <span className="hint">{c.hint}</span>}
                    {c.keys ? <span className="keys">{c.keys.map((k) => <Kbd key={k}>{k}</Kbd>)}</span> : <span className="tag">{TAGS[c.group] ?? c.group}</span>}
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {panel && extras.length > 0 && (
          <div className="palette-actions" role="menu" aria-label="Actions">
            <div className="palette-group">{current?.label}</div>
            {extras.map((x, i) => (
              <button key={x.label} role="menuitem" className="palette-row sm" aria-selected={i === pi} onMouseMove={() => setPi(i)} onClick={() => { if (current) recordUse(current.id); x.run(); }}>
                <span className="tile">{x.icon}</span><span className="label">{x.label}</span>
              </button>
            ))}
          </div>
        )}
        <div className="palette-foot">
          <span className="palette-brand"><span className="dot" />McBot</span>
          <span className="grow" />
          <span className="row">{asking ? "Confirm" : current?.ask || current?.id === "ask-fallback" ? "Ask" : "Open"}<Kbd><CornerDownLeft size={11} /></Kbd></span>
          {!asking && extras.length > 0 && <span className="row">Actions<Kbd>{MOD}</Kbd><Kbd>K</Kbd></span>}
          <span className="row">{asking || panel ? "Back" : "Close"}<Kbd>esc</Kbd></span>
        </div>
      </div>
    </>
  );
}
