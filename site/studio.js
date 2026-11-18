/* The live windows on the landing page (markup in index.html, look in studio.css).
   Each window plays only while it is on screen, pauses under the pointer, and holds its final
   state for people who prefer less motion. No libraries; the faces come from foods.js. */
(() => {
  const F = window.McBotFoods;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const CANCEL = Symbol("cancel");

  /** A timeline that can be stopped, and paused (under the pointer, or off screen). */
  function runner() {
    let id = 0;
    let paused = false;
    return {
      pause(v) { paused = v; },
      stop() { id++; },
      start(fn) {
        const mine = ++id;
        const sleep = async (ms) => {
          for (let left = ms; left > 0;) {
            if (mine !== id) throw CANCEL;
            await new Promise((r) => setTimeout(r, 40));
            if (!paused) left -= 40;
          }
          if (mine !== id) throw CANCEL;
        };
        return fn({ sleep, alive: () => mine === id }).catch((e) => { if (e !== CANCEL) throw e; });
      },
    };
  }

  /** Calls `on(true)` when `el` is mostly on screen and `on(false)` when it leaves. */
  function whenVisible(el, on) {
    if (!("IntersectionObserver" in window)) { on(true); return; }
    new IntersectionObserver((es) => on(es[es.length - 1].isIntersecting), { threshold: 0.35 }).observe(el);
  }

  const face = (expr, uid) => F ? F.foodSvg({ seed: "cup", food: "cup", tone: 2, size: 44, expression: expr, uid, title: "" }) : "";

  /** The pointer: moves to an element's centre inside its window; `tap` presses. */
  function pointer(win) {
    const el = document.createElement("div");
    el.className = "cur";
    el.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><path d="M4 2l13 8.5-5.6 1.4L14 18.5l-2.6 1-2.6-6.4L4 17z" fill="#fff" stroke="#000" stroke-width="1.2" stroke-linejoin="round"/></svg>';
    win.appendChild(el);
    const at = (t, dx = 0, dy = 0) => {
      const r = t.getBoundingClientRect();
      const w = win.getBoundingClientRect();
      return [r.left - w.left + r.width / 2 - 3 + dx, r.top - w.top + r.height / 2 - 2 + dy];
    };
    return {
      el,
      show(x, y) { el.style.transition = "none"; el.style.transform = `translate(${x}px, ${y}px)`; void el.offsetWidth; el.style.transition = ""; el.classList.add("on"); },
      hide() { el.classList.remove("on"); },
      to(t, dx, dy) { const [x, y] = at(t, dx, dy); el.style.transform = `translate(${x}px, ${y}px)`; return [x, y]; },
      at,
      async tap(ctx) { el.classList.add("tap"); await ctx.sleep(140); el.classList.remove("tap"); },
    };
  }

  /** The island in a window's title bar. */
  function island(el) {
    return (state, text) => { el.dataset.s = state; el.innerHTML = `<span class="dot"></span><span class="txt">${esc(text)}</span>`; };
  }

  const type = async (ctx, el, text, speed = 22) => {
    el.classList.add("caret");
    el.textContent = "";
    for (const ch of text) { el.textContent += ch; await ctx.sleep(speed); }
    el.classList.remove("caret");
  };

  // ---------------------------------------------------------------- hero
  // A replica of the app as it opens: ask an agent, watch it use its tools, answer, and ask before acting.
  const hero = $("[data-hero]");
  if (hero) {
    const foodFace = (el, expr, uid) => {
      if (!F) return;
      el.innerHTML = F.foodSvg({ seed: el.dataset.food, food: el.dataset.food, tone: +el.dataset.tone, size: el.dataset.main !== undefined ? 26 : 34, expression: expr, uid, title: "" });
    };
    $$(".face[data-food]", hero).forEach((el, i) => foodFace(el, "idle", `hf${i}`));
    const mainFaces = $$('.face[data-food="cup"]', hero);
    const setFace = (expr) => mainFaces.forEach((el, i) => foodFace(el, expr, `hm${i}${expr}`));
    const notch = $("[data-notch]", hero);
    const thread = $("[data-thread]", hero);
    const input = $("[data-input]", hero);
    const last = $("[data-last]", hero);
    const time = $("[data-time]", hero);
    const cur = pointer(hero);
    const run = runner();
    let clock = 0;
    const say = (text, kind = "") => {
      clearInterval(clock);
      notch.className = `notch ${kind}`;
      notch.innerHTML = `<span class="nt">${esc(text)}</span>`;
      if (kind === "work") {
        const t0 = Date.now();
        const tm = document.createElement("span"); tm.className = "tm"; notch.appendChild(tm);
        const tick = () => { tm.textContent = `0:${String(Math.floor((Date.now() - t0) / 1000) % 60).padStart(2, "0")}`; };
        tick(); clock = setInterval(tick, 500);
      }
    };
    const add = (html, cls) => { const el = document.createElement("div"); el.className = cls; el.innerHTML = html; thread.appendChild(el); void el.offsetWidth; el.classList.add("in"); return el; };
    const ASK = "Which tickets need me today?";
    const LINES = ["Three need you today:", "1. Acme invoice, billing asks you to approve the refund", "2. Login loop for Northwind, marked urgent", "3. A data export request, due Friday"];

    const reset = () => {
      cur.hide(); thread.textContent = ""; input.textContent = "Message Researcher"; input.classList.remove("typed");
      last.textContent = "Finds sources and sums them up"; time.textContent = ""; setFace("idle"); say("Ready");
    };
    const final = () => {
      reset();
      add(esc(ASK), "msg me");
      add('<span class="tool done">Docs · searched tickets</span><span class="tool done">Files · read sla.md</span>', "tools");
      add(LINES.map((l) => `<p>${esc(l)}</p>`).join(""), "msg ai");
      add('<div class="ask-h">Researcher asks before acting</div><code>Email Sam: "Please approve the Acme refund"</code><div class="ask-done">Allowed once · sent</div>', "askc done");
      setFace("happy"); say("Researcher answered", "ok"); last.textContent = "Sent the email to Sam"; time.textContent = "9:41";
    };

    async function play(ctx) {
      reset();
      await ctx.sleep(900);
      // you type and send
      input.classList.add("typed"); input.textContent = "";
      for (const ch of ASK) { input.textContent += ch; await ctx.sleep(42); }
      await ctx.sleep(350);
      input.textContent = "Message Researcher"; input.classList.remove("typed");
      add(esc(ASK), "msg me");
      time.textContent = "9:41";
      await ctx.sleep(500);
      // the agent works: its face thinks, the island counts, its tools show up
      setFace("thinking"); say("Researcher is working", "work");
      const tools = add('<span class="tool">Docs · searching tickets</span>', "tools");
      await ctx.sleep(1300);
      tools.firstElementChild.classList.add("done"); tools.firstElementChild.textContent = "Docs · searched tickets";
      tools.insertAdjacentHTML("beforeend", '<span class="tool">Files · reading sla.md</span>');
      await ctx.sleep(1100);
      tools.lastElementChild.classList.add("done"); tools.lastElementChild.textContent = "Files · read sla.md";
      await ctx.sleep(300);
      // the answer streams in
      const ans = add("", "msg ai");
      for (const line of LINES) {
        const p = document.createElement("p"); ans.appendChild(p);
        p.classList.add("caret");
        for (const word of line.split(" ")) { p.textContent += (p.textContent ? " " : "") + word; await ctx.sleep(38); }
        p.classList.remove("caret");
        await ctx.sleep(160);
      }
      last.textContent = "Three need you today";
      await ctx.sleep(700);
      // it asks before acting; the pointer answers
      const card = add('<div class="ask-h">Researcher asks before acting</div><code>Email Sam: "Please approve the Acme refund"</code><div class="ask-row"><button class="tb a" type="button" tabindex="-1">Allow once</button><button class="tb" type="button" tabindex="-1">Deny</button></div><div class="ask-done">Allowed once · sent</div>', "askc");
      say("Researcher asks before acting", "ask");
      await ctx.sleep(1200);
      const btn = $(".a", card);
      const [x, y] = cur.at(btn, 60, 50); cur.show(x, y);
      await ctx.sleep(120); cur.to(btn); await ctx.sleep(1000);
      await cur.tap(ctx);
      card.classList.add("done"); cur.hide();
      setFace("happy"); say("Researcher answered", "ok");
      last.textContent = "Sent the email to Sam";
      await ctx.sleep(4800);
      thread.classList.add("fade"); await ctx.sleep(450); thread.classList.remove("fade");
    }
    async function loop() { for (;;) await run.start(play); }
    if (reduce) final();
    else {
      reset();
      let started = false;
      whenVisible(hero, (v) => { run.pause(!v); if (v && !started) { started = true; void loop(); } });
      hero.addEventListener("pointerenter", () => run.pause(true));
      hero.addEventListener("pointerleave", () => run.pause(false));
    }
  }

  // ------------------------------------------------------------ how it works
  const flow = $("[data-flow]");
  if (flow) {
    $$("[data-face]", flow).forEach((e, i) => { e.innerHTML = face(e.dataset.face, `flow${i}`); });
    const win = $(".mac", flow);
    const isl = island($(".isl", win));
    const cur = pointer(win);
    const tabs = $$(".tab", flow);
    const scenes = Object.fromEntries($$(".scene", flow).map((s) => [s.dataset.scene, s]));
    const run = runner();
    const NAMES = { draw: "Draw", compile: "Compile", run: "Run", watch: "Watch" };
    const q = (sel) => $(sel, flow);

    const S = {
      async draw(ctx) {
        const sc = scenes.draw;
        const nd = $$(".nd", sc); const w = $$("svg.w path", sc); const lb = $$(".lbl", sc); const parts = $$(".part", sc);
        for (const e of [...nd.slice(1), ...lb]) e.classList.remove("in");
        for (const p of w) p.classList.remove("on");
        nd[0].classList.add("in");
        isl("rest", "Draw");
        await ctx.sleep(500);
        let first = true;
        for (let i = 0; i < parts.length; i++) {
          const part = parts[i];
          if (first) { const [x, y] = cur.at(part, 30, 20); cur.show(x, y); first = false; await ctx.sleep(200); }
          cur.to(part);
          await ctx.sleep(900);
          cur.el.classList.add("tap");
          const clone = part.cloneNode(true);
          clone.classList.add("drag", "on");
          const pr = part.getBoundingClientRect(); const wr = win.getBoundingClientRect();
          clone.style.cssText = `left:${pr.left - wr.left}px;top:${pr.top - wr.top}px;width:${pr.width}px`;
          win.appendChild(clone);
          await ctx.sleep(150);
          const [cx, cy] = cur.to(nd[i + 1]);
          const [px, py] = cur.at(part, 0, 0);
          clone.style.transform = `translate(${cx - px}px, ${cy - py}px)`;
          await ctx.sleep(1000);
          cur.el.classList.remove("tap");
          clone.remove();
          nd[i + 1].classList.add("in");
          w[i].classList.add("on");
          await ctx.sleep(300);
          lb[i].classList.add("in");
          await ctx.sleep(500);
        }
        cur.hide();
      },
      async compile(ctx) {
        const sc = scenes.compile;
        const tree = $$(".tree div", sc); const ln = $$(".ln", sc); const keys = $(".keys", sc);
        for (const e of [...tree, ...ln, keys]) e.classList.remove("in", "add", "del", "sel");
        keys.classList.remove("press");
        $(".old", sc).classList.add("in");
        $(".old", sc).classList.remove("del"); $(".new", sc).classList.remove("in", "add");
        tree[1].lastElementChild.textContent = "734 B";
        isl("rest", "researcher/config.yaml");
        for (const t of tree) { t.classList.add("in"); await ctx.sleep(120); }
        tree[1].classList.add("sel");
        for (const l of ln) { if (l.classList.contains("new")) continue; l.classList.add("in"); await ctx.sleep(140); }
        await ctx.sleep(900);
        keys.classList.add("in");
        await ctx.sleep(500);
        keys.classList.add("press"); isl("compile", "Compiling…");
        await ctx.sleep(260);
        keys.classList.remove("press");
        $(".old", sc).classList.add("del");
        $(".new", sc).classList.add("in", "add");
        tree[1].lastElementChild.textContent = "737 B";
        await ctx.sleep(500);
        isl("rest", "Compiled · 1 file changed");
      },
      async run(ctx) {
        const sc = scenes.run;
        const me = $(".me", sc); const ai = $(".ai", sc); const ask = $(".ask", sc); const done = $(".done-line", sc);
        for (const e of [me, ask]) e.classList.remove("in", "done");
        ai.textContent = ""; done.textContent = "";
        isl("rest", "Researcher");
        await ctx.sleep(500);
        me.classList.add("in");
        await ctx.sleep(600);
        isl("work", "Researcher is working");
        await type(ctx, ai, "Cleaning up the old build.", 24);
        await ctx.sleep(500);
        ask.classList.add("in");
        isl("ask", "Researcher asks before acting");
        await ctx.sleep(1300);
        const btn = $(".a", ask);
        const [x, y] = cur.at(btn, 40, 40); cur.show(x, y);
        await ctx.sleep(150);
        cur.to(btn);
        await ctx.sleep(1100);
        await cur.tap(ctx);
        ask.classList.add("done");
        cur.hide();
        isl("work", "Researcher is working");
        await ctx.sleep(900);
        await type(ctx, done, "Done. Removed build/ (214 MB).", 24);
        isl("rest", "Researcher answered");
      },
      async watch(ctx) {
        const sc = scenes.watch;
        const bars = $$(".bars i", sc); const mem = $$(".mem div", sc); const num = $(".big", sc);
        for (const b of bars) b.style.height = "0";
        for (const m of mem) m.classList.remove("in");
        num.textContent = "$0.00";
        isl("rest", "Cost and memory");
        await ctx.sleep(500);
        const H = [38, 52, 30, 66, 44, 58, 80];
        for (let i = 0; i < bars.length; i++) { bars[i].style.height = `${H[i]}%`; await ctx.sleep(110); }
        for (let i = 1; i <= 14; i++) { num.textContent = `$${(0.42 * i / 14).toFixed(2)}`; await ctx.sleep(45); }
        await ctx.sleep(500);
        for (const m of mem) { m.classList.add("in"); await ctx.sleep(500); }
      },
    };
    const DUR = { draw: 12500, compile: 10500, run: 12000, watch: 9500 };
    let cur_i = 0; let auto = true; let visible = false; let started = false;

    function show(i) {
      cur_i = (i + tabs.length) % tabs.length;
      const key = tabs[cur_i].dataset.tab;
      run.stop(); cur.hide();
      $$(".drag", win).forEach((d) => d.classList.remove("on"));
      tabs.forEach((t, n) => { t.setAttribute("aria-selected", String(n === cur_i)); t.classList.remove("run"); });
      Object.entries(scenes).forEach(([k, s]) => s.classList.toggle("on", k === key));
      const t = tabs[cur_i];
      if (reduce) { void run.start(S[key]); return; }
      void t.offsetWidth;
      t.style.setProperty("--dur", `${DUR[key]}ms`);
      if (visible) t.classList.add("run");
      void run.start(S[key]);
    }
    tabs.forEach((t, i) => t.addEventListener("click", () => { auto = false; show(i); }));
    // The progress bar runs out, then the next step starts (until someone picks a step).
    flow.addEventListener("animationend", (e) => {
      if (e.animationName === "bar" && auto && !reduce) show(cur_i + 1);
    });
    show(0);
    if (!reduce) {
      run.pause(true);
      $$(".tab", flow).forEach((t) => t.classList.remove("run"));
      whenVisible(flow, (v) => {
        visible = v; run.pause(!v);
        const t = tabs[cur_i];
        if (v && !started) { started = true; show(0); }
        else if (v) t.classList.add("run");
        else t.classList.remove("run");
      });
      win.addEventListener("pointerenter", () => run.pause(true));
      win.addEventListener("pointerleave", () => run.pause(!visible));
    }
    void NAMES; void q;
  }

  // ------------------------------------------------------------------ palette
  const pal = $("[data-pal]");
  if (pal) {
    const IC = {
      plus: '<path d="M5 12h14M12 5v14"/>', search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>', check: '<path d="M20 6 9 17l-5-5"/>',
      send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>', folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
      users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.4 3.2-5 6.5-5s5.9 1.6 6.5 5"/>', gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
      home: '<path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/>', hammer: '<path d="m15 12-8.4 8.4a2.1 2.1 0 0 1-3-3L12 9"/><path d="m17.6 15 4-4-4-4-3 3"/>',
    };
    const CMDS = [
      { g: "Create", l: "Agent", h: "Name it, say what it does", i: "plus", blue: 1 },
      { g: "Create", l: "Task", h: "Give an agent something to do", i: "check", blue: 1 },
      { g: "Create", l: "Local model", h: "Ollama, LM Studio, vLLM…", i: "folder", blue: 1 },
      { g: "Create", l: "Chat app…", h: "Telegram, Slack, Discord and more", i: "send", blue: 1 },
      { g: "Command", l: "Compile", h: "Write the agents' files", i: "hammer", k: "⌘S" },
      { g: "Command", l: "Check the harness", h: "What's wrong, and the fix", i: "check" },
      { g: "Command", l: "Invite teammates…", h: "Copy a link, email it", i: "users" },
      { g: "Command", l: "Settings", h: "Models, keys, your name", i: "gear", k: "⌘," },
      { g: "Go to", l: "Home", h: "", i: "home", k: "⌘1" },
      { g: "Go to", l: "Board", h: "Design the harness", i: "search", k: "⌘2" },
      { g: "Go to", l: "Chat", h: "Talk to your agents", i: "send", k: "⌘3" },
    ];
    const word = (w, t) => { const a = t.indexOf(w); if (a === 0) return 100; if (a > 0) return /[\s\-_/.]/.test(t[a - 1]) ? 80 : 55; if (w.length < 3) return 0; let p = -1; for (const ch of w) { p = t.indexOf(ch, p + 1); if (p < 0) return 0; } return 25; };
    const score = (q, c) => { const ws = q.toLowerCase().split(/\s+/).filter(Boolean); let s = 0; for (const w of ws) { const n = word(w, c.l.toLowerCase()); const m = word(w, `${c.h} ${c.g}`.toLowerCase()); const b = n || (m >= 55 ? m / 3 : 0); if (!b) return 0; s += b; } return s / ws.length; };
    const input = $("input", pal); const list = $(".list", pal); const note = $("[data-pal-note]");
    let sel = 0; let shown = []; let touched = false;
    const svg = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[k]}</svg>`;
    const render = () => {
      const q = input.value.trim();
      let rs = q ? CMDS.map((c) => ({ c, s: score(q, c) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.c) : CMDS;
      rs = rs.slice(0, 7);
      shown = rs.map((c) => ({ ...c, tag: c.g }));
      if (q.length >= 3) shown.push({ g: "Ask", l: "Ask Researcher", h: `“${q.slice(0, 50)}”`, i: "send", blue: 1, tag: "Ask", ask: 1 });
      sel = Math.min(sel, Math.max(0, shown.length - 1));
      let last = ""; let html = "";
      shown.forEach((c, n) => {
        if (c.g !== last) { html += `<div class="grp">${c.g}</div>`; last = c.g; }
        html += `<div class="r" role="option" data-n="${n}" aria-selected="${n === sel}"><span class="t${c.blue ? " blue" : ""}">${svg(c.i)}</span><b>${esc(c.l)}</b><small>${esc(c.h)}</small>${c.k ? `<em>${c.k}</em>` : `<em>${c.tag}</em>`}</div>`;
      });
      list.innerHTML = html || '<div class="grp">No results</div>';
      const cur_ = shown[sel];
      $("[data-pal-primary]", pal).textContent = cur_ && cur_.ask ? "Ask" : "Open";
    };
    const choose = (n) => { const c = shown[n]; if (!c) return; note.textContent = c.ask ? `↵ would send “${input.value.trim()}” to Researcher and open the chat.` : `↵ would run “${c.l}” in the app.`; };
    input.addEventListener("input", () => { touched = true; sel = 0; render(); });
    input.addEventListener("focus", () => { touched = true; });
    input.addEventListener("keydown", (e) => {
      touched = true;
      if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(shown.length - 1, sel + 1); render(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(0, sel - 1); render(); }
      else if (e.key === "Enter") { e.preventDefault(); choose(sel); }
      else if (e.key === "Escape") { input.value = ""; sel = 0; render(); note.textContent = ""; }
    });
    list.addEventListener("mousemove", (e) => { const r = e.target.closest(".r"); if (r && +r.dataset.n !== sel) { sel = +r.dataset.n; render(); } });
    list.addEventListener("click", (e) => { const r = e.target.closest(".r"); if (r) choose(+r.dataset.n); });
    render();
    if (!reduce) {
      const run = runner();
      let started = false;
      whenVisible(pal, (v) => {
        if (!v || started || touched) return;
        started = true;
        void run.start(async (ctx) => {
          const typeIn = async (text) => { for (const ch of text) { if (touched) throw CANCEL; input.value += ch; sel = 0; render(); await ctx.sleep(150); } };
          await ctx.sleep(600);
          await typeIn("cmpl");
          await ctx.sleep(1700);
          input.value = ""; render();
          await ctx.sleep(500);
          await typeIn("who owns billing");
        });
      });
    }
  }

  // ------------------------------------------------------------------- island
  const desk = $("[data-desk]");
  if (desk) {
    const pill = $(".pill", desk);
    const top = $(".top", pill);
    const toast = $(".toastlet", desk);
    const cmd = $("code", pill);
    const hideBtn = $("[data-hide]", desk.parentElement);
    const run = runner();
    let auto = !reduce;
    let t0 = 0; let timer = 0;
    const say = (m) => { toast.textContent = m; toast.classList.add("in"); setTimeout(() => toast.classList.remove("in"), 1800); };
    const state = (s) => {
      pill.dataset.s = s;
      clearInterval(timer);
      if (s === "rest") top.innerHTML = '<span class="dot"></span><span>McBot</span>';
      if (s === "ask") top.innerHTML = '<span class="dot"></span><span>Researcher asks before acting</span>';
      if (s === "work") {
        t0 = Date.now();
        top.innerHTML = '<span>Researcher is working</span><span class="tm"></span>';
        const tm = top.lastElementChild;
        const draw = () => { tm.textContent = `0:${String(Math.floor((Date.now() - t0) / 1000) % 60).padStart(2, "0")}`; };
        draw(); timer = setInterval(draw, 500);
      }
    };
    const answer = (choice) => { say(choice === "once" ? "Allowed once. The agent carries on." : "Denied. The agent is told no."); state("rest"); };
    $$("[data-act]", pill).forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); auto = false; run.stop(); answer(b.dataset.act); }));
    $$("[data-do]", desk.parentElement).forEach((b) => b.addEventListener("click", () => { auto = false; run.stop(); const d = b.dataset.do; if (d === "work") state("work"); else if (d === "ask") { cmd.textContent = "rm -rf ~/Projects/site/build"; state("ask"); } else state("rest"); }));
    hideBtn?.addEventListener("click", () => { auto = false; run.stop(); const on = !desk.classList.contains("hidden"); desk.classList.toggle("hidden", on); hideBtn.setAttribute("aria-pressed", String(on)); hideBtn.textContent = on ? "Show McBot" : "Hide McBot"; if (on) { state("work"); say("McBot is hidden. The island stays."); } });
    pill.addEventListener("click", () => { if (desk.classList.contains("hidden")) { desk.classList.remove("hidden"); hideBtn.setAttribute("aria-pressed", "false"); hideBtn.textContent = "Hide McBot"; state("rest"); say("Back in McBot."); } });
    state("rest");
    if (auto) {
      let started = false;
      whenVisible(desk, (v) => {
        run.pause(!v);
        if (!v || started) return;
        started = true;
        void (async () => {
          while (auto) {
            await run.start(async (ctx) => {
              state("rest"); await ctx.sleep(1600);
              state("work"); await ctx.sleep(3200);
              cmd.textContent = "rm -rf ~/Projects/site/build"; state("ask"); await ctx.sleep(4200);
              if (auto) answer("once");
              await ctx.sleep(2200);
            });
          }
        })();
      });
    }
  }
})();

/* ---------- live cards: play once when they scroll into view; numbers count up ---------- */
(() => {
  const cards = [...document.querySelectorAll("[data-play]")];
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const count = (card) => {
    for (const el of card.querySelectorAll("[data-count]")) {
      const to = parseFloat(el.dataset.count); const pre = el.dataset.pre || ""; const suf = el.dataset.suf || ""; const dec = +(el.dataset.dec || 0);
      const show = (v) => { el.textContent = `${pre}${v.toFixed(dec)}${suf}`; };
      if (reduce) { show(to); continue; }
      const t0 = performance.now();
      const tick = (t) => { const k = Math.min(1, (t - t0) / 1100); show(to * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    }
  };
  if (!("IntersectionObserver" in window) || reduce) { for (const c of cards) { c.classList.add("play"); count(c); } return; }
  const io = new IntersectionObserver((es) => {
    for (const e of es) if (e.isIntersecting) { e.target.classList.add("play"); count(e.target); io.unobserve(e.target); }
  }, { threshold: 0.3 });
  for (const c of cards) io.observe(c);
})();

/* ---------- reveals and the keys ---------- */
(() => {
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  // reveals
  const rv = $$("[data-reveal]");
  if (!("IntersectionObserver" in window) || reduce) rv.forEach((e) => e.classList.add("in"));
  else {
    const io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
    rv.forEach((e) => io.observe(e));
  }
  // the keys press on their own, and for real when you press them
  const keys = $$("[data-keys] .keycap");
  if (keys.length) {
    const press = (on) => keys.forEach((k) => k.classList.toggle("down", on));
    addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.code === "Space") { e.preventDefault(); press(true); $$("[data-pal] input")[0]?.focus(); } });
    addEventListener("keyup", () => press(false));
    if (!reduce) {
      let visible = false;
      new IntersectionObserver((es) => { visible = es[0].isIntersecting; }, { threshold: 0.5 }).observe(keys[0].parentElement);
      setInterval(() => { if (!visible) return; keys.forEach((k, i) => setTimeout(() => k.classList.add("down"), i * 120)); setTimeout(() => press(false), 650); }, 4200);
    }
  }
})();

/* ---------- the split download button: your OS, and a menu for the others ---------- */
(() => {
  const split = document.querySelector("[data-split]");
  if (!split) return;
  const more = split.querySelector(".split-more");
  const menu = split.querySelector(".split-menu");
  const set = (open) => { menu.hidden = !open; more.setAttribute("aria-expanded", String(open)); };
  more.addEventListener("click", (e) => { e.stopPropagation(); set(menu.hidden); });
  menu.addEventListener("click", () => set(false));
  document.addEventListener("click", (e) => { if (!split.contains(e.target)) set(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") set(false); });
})();
