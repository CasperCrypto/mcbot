import {
  BookOpen, Bot, Brain, Code2, Globe, House, ListChecks, Cpu, Send, ChartColumnBig, Cloud, CornerDownLeft, Download, FolderOpen, FolderPlus, Hammer, HardDrive, Layers, LifeBuoy, MessagesSquare, Plug, Plus, RotateCcw, Search, Server, Sparkles, Upload, Users, Waypoints, Workflow,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { addEdge, addNode } from "../../board/ydoc";
import type { GraphNode } from "../../contracts/graph";
import { compileBoard, exportBoardFile, importBoardFile } from "../actions";
import { newChannel, newId, newModel, newTool, newVault } from "../graph/defaults";
import { freeSpot } from "../graph/place";
import { resetDemo } from "../demo/engine";
import { DEMO, engine } from "../lib/engine";
import { useBoard } from "../state/board";
import { useApp, type Tab } from "../state/store";
import { AgentFace, Kbd } from "../ui";

interface Command {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: ReactNode;
  keys?: string[];
  run?: () => void;
  /** Selecting it asks for one line of input first (Raycast-style). */
  ask?: { placeholder: string; submit: (value: string) => Promise<void> | void };
}

export const VIEWS: { tab: Tab; label: string; icon: ReactNode }[] = [
  { tab: "home", label: "Home", icon: <House size={15} /> },
  { tab: "graph", label: "Graph", icon: <Waypoints size={15} /> },
  { tab: "agents", label: "Agents", icon: <MessagesSquare size={15} /> },
  { tab: "tasks", label: "Tasks", icon: <ListChecks size={15} /> },
  { tab: "code", label: "Code", icon: <Code2 size={15} /> },
  { tab: "browser", label: "Browser", icon: <Globe size={15} /> },
  { tab: "workflows", label: "Activity", icon: <Workflow size={15} /> },
  { tab: "memory", label: "Memory", icon: <Brain size={15} /> },
  { tab: "files", label: "Files", icon: <FolderOpen size={15} /> },
  { tab: "cost", label: "Cost", icon: <ChartColumnBig size={15} /> },
  { tab: "team", label: "Team", icon: <Users size={15} /> },
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
      { id: "add-tool-catalog", group: "Create", label: "Tool…", hint: "Browser, web search, Notion…", icon: <Plug size={15} />, run: () => app.setCatalogOpen(true) },
      { id: "add-mcp", group: "Create", label: "MCP server", icon: <Server size={15} />, run: () => place(newTool(graph, "stdio", at("tool"), null)) },
      { id: "add-telegram", group: "Create", label: "Telegram bot", hint: "Talk to an agent from Telegram", icon: <Send size={15} />, run: () => place(newChannel(graph, "telegram", at("channel"))) },
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
      { id: "compile", group: "Actions", label: "Compile", icon: <Hammer size={15} />, keys: ["⌘", "S"], run: () => { close(); void compileBoard(boardId); } },
      {
        id: "open-folder", group: "Actions", label: "Open folder…", hint: "See any folder as a graph", icon: <FolderPlus size={15} />,
        ask: {
          placeholder: "/Users/you/project",
          submit: async (path) => {
            try {
              await engine.openFolder(path.trim());
              app.setTab("files");
              close();
            } catch (err) {
              app.toast({ kind: "fail", text: (err as Error).message });
            }
          },
        },
      },
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
      { id: "import-board", group: "Actions", label: "Import board…", hint: "Open a board file", icon: <Upload size={15} />, run: () => { close(); importBoardFile(); } },
      { id: "hermes", group: "Actions", label: "Engine", hint: "Status and restart", icon: <Cpu size={15} />, run: () => app.setHermesOpen(true) },
      { id: "report", group: "Actions", label: "Report a problem…", hint: "Details to paste into an issue", icon: <LifeBuoy size={15} />, run: () => app.setReportOpen(true) },
      { id: "setup", group: "Actions", label: "Set up a new team…", hint: "Run the setup assistant again", icon: <Sparkles size={15} />, run: () => { close(); app.setSetup({ completed: false, profile: null }); } },
      ...(DEMO ? [{ id: "reset-demo", group: "Actions", label: "Reset demo", hint: "Start over with the sample board", icon: <RotateCcw size={15} />, run: resetDemo }] : []),
      ...VIEWS.map((v, i) => ({ id: `go-${v.tab}`, group: "Go to", label: v.label, icon: v.icon, keys: ["⌘", String(i + 1)], run: () => { app.setTab(v.tab); close(); } })),
      ...graph.nodes.filter((n) => n.kind === "agent").map((n) => ({
        id: `chat-${n.id}`, group: "Agents", label: n.data.displayName || n.data.name, hint: `@${n.data.name}`,
        icon: <AgentFace seed={n.data.name} size={22} />, run: () => { app.openChat(n.id); close(); },
      })),
      ...app.boards.filter((b) => b.id !== boardId).map((b) => ({ id: `board-${b.id}`, group: "Boards", label: b.name || b.id, icon: <Layers size={15} />, run: () => { app.setBoard(b.id); close(); } })),
    ];
    return cmds;
  }, [graph, doc, boardId, app, close]);
}

function matches(c: Command, q: string): boolean {
  const hay = `${c.label} ${c.hint ?? ""} ${c.group}`.toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

export function Palette() {
  const open = useApp((s) => s.paletteOpen);
  const setPalette = useApp((s) => s.setPalette);
  if (!open) return null;
  return <PaletteBody close={() => setPalette(false)} />;
}

function PaletteBody({ close }: { close: () => void }) {
  const commands = useCommands(close);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [asking, setAsking] = useState<Command | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const shown = useMemo(() => (asking ? [] : commands.filter((c) => matches(c, query))), [commands, query, asking]);
  // Block bodies on purpose: scrollIntoView returns a Promise in current Chromium,
  // and an effect that returns a non-function crashes React on cleanup.
  useEffect(() => {
    setIndex(0);
  }, [query, asking]);
  useEffect(() => {
    input.current?.focus();
  }, [asking]);
  useEffect(() => {
    void list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [index]);

  const choose = (c: Command | undefined) => {
    if (!c) return;
    if (c.ask) {
      setAsking(c);
      setQuery("");
    } else c.run?.();
  };
  const onKey = (e: React.KeyboardEvent) => {
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
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (asking) {
        if (query.trim()) void asking.ask!.submit(query);
      } else choose(shown[index]);
    }
  };

  let lastGroup = "";
  return (
    <>
      <div className="palette-scrim" onClick={close} />
      <div className="palette" role="dialog" aria-label="Command palette" data-testid="palette">
        <div className="palette-input">
          {asking ? <span className="chip accent">{asking.label.replace("…", "")}</span> : <Search size={18} className="faint" />}
          <input ref={input} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKey}
            placeholder={asking ? asking.ask!.placeholder : "Search or run a command"} spellCheck={false} aria-label="Command" />
        </div>
        {!asking && (
          <div className="palette-list" ref={list} role="listbox">
            {shown.length === 0 && <div className="palette-group">No results</div>}
            {shown.map((c, i) => {
              const head = c.group !== lastGroup ? <div className="palette-group">{(lastGroup = c.group)}</div> : null;
              return (
                <div key={c.id}>
                  {head}
                  <button className="palette-row" role="option" aria-selected={i === index} onMouseMove={() => setIndex(i)} onClick={() => choose(c)}>
                    <span className="tile">{c.icon}</span>
                    <span className="label">{c.label}</span>
                    {c.hint && <span className="hint">{c.hint}</span>}
                    {c.keys && <span className="keys">{c.keys.map((k) => <Kbd key={k}>{k}</Kbd>)}</span>}
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <div className="palette-foot">
          <span className="row"><Kbd><CornerDownLeft size={11} /></Kbd>{asking ? "Confirm" : "Open"}</span>
          <span className="row"><Kbd>↑</Kbd><Kbd>↓</Kbd>Move</span>
          <span className="row"><Kbd>esc</Kbd>{asking ? "Back" : "Close"}</span>
        </div>
      </div>
    </>
  );
}
