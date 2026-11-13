/**
 * An agent's answer as blocks: the Markdown people and models write (headings, lists, quotes,
 * tables, code, rules) plus two fenced blocks McBot draws as interface:
 *
 *   ```chart    {"type":"bar"|"line"|"pie","title":"…","labels":[…],"series":[{"name":"…","data":[…]}]}
 *   ```choices  one reply per line: buttons that answer the agent
 *
 * Pure (text in, blocks out) and never HTML: the chat renders these as React elements, so an answer
 * can't run code in the app whatever it contains.
 */
export type Inline =
  | { t: "text"; v: string }
  | { t: "b"; v: Inline[] }
  | { t: "i"; v: Inline[] }
  | { t: "code"; v: string }
  | { t: "link"; v: string; href: string }
  | { t: "img"; alt: string; src: string };

export interface Chart {
  type: "bar" | "line" | "pie";
  title?: string;
  labels: string[];
  series: { name: string; data: number[] }[];
}

export type Block =
  | { t: "p"; v: Inline[] }
  | { t: "h"; level: 1 | 2 | 3; v: Inline[] }
  | { t: "ul" | "ol"; items: Inline[][] }
  | { t: "quote"; v: Inline[] }
  | { t: "code"; lang: string; v: string }
  | { t: "table"; head: Inline[][]; rows: Inline[][][] }
  | { t: "hr" }
  | { t: "chart"; chart: Chart }
  | { t: "choices"; items: string[] };

/** `**bold**`, `*italic*`/`_italic_`, `` `code` ``, `[text](url)`, `![alt](src)`. */
export function inline(text: string): Inline[] {
  const out: Inline[] = [];
  const re = /(!\[([^\]]*)\]\(([^)\s]+)\))|(\[([^\]]+)\]\(([^)\s]+)\))|(`([^`]+)`)|(\*\*([^*]+)\*\*)|(__([^_]+)__)|(\*([^*\s][^*]*)\*)|(\b_([^_\s][^_]*)_\b)/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ t: "text", v: text.slice(last, m.index) });
    if (m[1]) out.push({ t: "img", alt: m[2]!, src: m[3]! });
    else if (m[4]) out.push({ t: "link", v: m[5]!, href: m[6]! });
    else if (m[7]) out.push({ t: "code", v: m[8]! });
    else if (m[9] || m[11]) out.push({ t: "b", v: inline(m[10] ?? m[12]!) });
    else out.push({ t: "i", v: inline(m[14] ?? m[16]!) });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ t: "text", v: text.slice(last) });
  return out;
}

const cells = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

/** A chart block's JSON, checked: numbers only, labels and data lined up. Null when it isn't one. */
export function parseChart(json: string): Chart | null {
  try {
    const c = JSON.parse(json) as Partial<Chart>;
    const type = c.type === "line" || c.type === "pie" ? c.type : c.type === "bar" ? "bar" : null;
    if (!type || !Array.isArray(c.labels) || !Array.isArray(c.series) || c.series.length === 0) return null;
    const labels = c.labels.map(String).slice(0, 60);
    const series = c.series.slice(0, 6).map((s, i) => ({
      name: String(s?.name ?? `Series ${i + 1}`),
      data: Array.isArray(s?.data) ? s.data.slice(0, labels.length).map((n) => (typeof n === "number" && Number.isFinite(n) ? n : 0)) : [],
    }));
    if (series.some((s) => s.data.length === 0)) return null;
    return { type, title: typeof c.title === "string" ? c.title : undefined, labels, series };
  } catch {
    return null;
  }
}

export function parseRich(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ t: "p", v: inline(para.join("\n")) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = /^\s*```\s*([\w-]*)\s*$/.exec(line);
    if (fence) {
      flush();
      const body: string[] = [];
      for (i++; i < lines.length && !/^\s*```\s*$/.test(lines[i]!); i++) body.push(lines[i]!);
      const lang = fence[1]!.toLowerCase();
      const chart = lang === "chart" ? parseChart(body.join("\n")) : null;
      if (chart) blocks.push({ t: "chart", chart });
      else if (lang === "choices") blocks.push({ t: "choices", items: body.map((l) => l.replace(/^\s*(?:[-*]|\d+[.)])\s*/, "").trim()).filter(Boolean).slice(0, 8) });
      else blocks.push({ t: "code", lang, v: body.join("\n") });
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      blocks.push({ t: "h", level: h[1]!.length as 1 | 2 | 3, v: inline(h[2]!) });
      continue;
    }
    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
      flush();
      blocks.push({ t: "hr" });
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? "")) {
      flush();
      const head = cells(line).map(inline);
      const rows: Inline[][][] = [];
      for (i += 2; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]!); i++) rows.push(cells(lines[i]!).map(inline));
      i--;
      blocks.push({ t: "table", head, rows });
      continue;
    }
    const list = /^\s*([-*+]|\d+[.)])\s+/.exec(line);
    if (list) {
      flush();
      const ordered = /\d/.test(list[1]!);
      const items: Inline[][] = [];
      for (; i < lines.length; i++) {
        const m = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]!);
        if (!m || /\d/.test(m[1]!) !== ordered) break;
        items.push(inline(m[2]!));
      }
      i--;
      blocks.push({ t: ordered ? "ol" : "ul", items });
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      flush();
      const q: string[] = [];
      for (; i < lines.length && /^\s*>\s?/.test(lines[i]!); i++) q.push(lines[i]!.replace(/^\s*>\s?/, ""));
      i--;
      blocks.push({ t: "quote", v: inline(q.join("\n")) });
      continue;
    }
    if (!line.trim()) flush();
    else para.push(line);
  }
  flush();
  return blocks;
}

/**
 * What an agent is told so it can answer this way: added to the souls McBot writes for new agents
 * (presets, starter teams, the New agent sheet). Plain words; Hermes passes SOUL.md to the model.
 */
export const RICH_ANSWERS = [
  "Format answers in Markdown: headings, lists, tables and code blocks.",
  'For numbers worth seeing, add a chart as a ```chart block of JSON: {"type":"bar"|"line"|"pie","title":"…","labels":[…],"series":[{"name":"…","data":[…]}]}.',
  "When the person should pick a next step, end with a ```choices block, one short reply per line.",
].join("\n");

export const withRichAnswers = (soul: string): string => (soul.includes("```chart") ? soul : soul.trim() ? `${soul.trim()}\n\n${RICH_ANSWERS}` : RICH_ANSWERS);
