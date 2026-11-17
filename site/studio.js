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
  const hero = $("[data-hero]");
  if (hero) {
    const isl = island($(".isl", hero));
    const cv = $("[data-cv]", hero);
    const nodes = $$(".nd", hero);
    const wires = $$("path", hero);
    const side = $("[data-side]", hero);
    const files = $("[data-files]", hero);
    const chat = $("[data-chat]", hero);
    const rows = $$(".frow", hero);
    const me = $(".me", hero);
    const ai = $(".ai", hero);
    const agent = $(".nd.agent", hero);
    const faceEl = $(".face", hero);
    const compile = $("[data-compile]", hero);
    const cur = pointer(hero);
    const run = runner();
    const ANSWER = "Three tickets need you: the Acme invoice (billing → Sam), a login loop that looks urgent, and a refund waiting for your OK.";

    const reset = () => {
      cur.hide();
      for (const n of nodes) n.classList.remove("in", "live");
      for (const w of wires) w.classList.remove("on", "hot");
      for (const r of rows) r.classList.remove("in", "hl");
      side.classList.remove("in"); cv.classList.remove("shift");
      files.style.opacity = "1"; chat.classList.remove("in"); me.classList.remove("in");
      ai.textContent = ""; compile.classList.remove("press");
      faceEl.innerHTML = face("idle", "hero-face");
      isl("rest", "Support desk");
    };
    const final = () => {
      reset();
      for (const n of nodes) n.classList.add("in");
      for (const w of wires) w.classList.add("on");
      for (const r of rows) r.classList.add("in");
      side.classList.add("in"); cv.classList.add("shift");
      files.style.opacity = "0"; chat.classList.add("in"); me.classList.add("in");
      ai.textContent = ANSWER;
      faceEl.innerHTML = face("happy", "hero-face");
      isl("rest", "Researcher answered");
    };

    async function play(ctx) {
      reset();
      await ctx.sleep(700);
      for (const n of nodes) { n.classList.add("in"); await ctx.sleep(260); }
      await ctx.sleep(300);
      for (const w of wires) { w.classList.add("on"); await ctx.sleep(180); }
      await ctx.sleep(700);
      const [x0, y0] = cur.at(cv, 40, 60);
      cur.show(x0, y0);
      await ctx.sleep(200);
      cur.to(compile);
      await ctx.sleep(1100);
      await cur.tap(ctx);
      compile.classList.add("press");
      isl("compile", "Compiling…");
      await ctx.sleep(180);
      compile.classList.remove("press");
      await ctx.sleep(600);
      isl("rest", "Compiled · 5 files");
      cv.classList.add("shift"); side.classList.add("in");
      await ctx.sleep(500);
      for (const r of rows) { r.classList.add("in"); await ctx.sleep(170); }
      rows[1]?.classList.add("hl");
      await ctx.sleep(1100);
      cur.to(agent);
      await ctx.sleep(1000);
      await cur.tap(ctx);
      files.style.opacity = "0";
      chat.classList.add("in");
      await ctx.sleep(300);
      me.classList.add("in");
      await ctx.sleep(500);
      cur.hide();
      agent.classList.add("live");
      faceEl.innerHTML = face("thinking", "hero-face");
      wires[0].classList.add("hot"); wires[2].classList.add("hot");
      isl("work", "Researcher is working");
      await ctx.sleep(1300);
      await type(ctx, ai, ANSWER, 18);
      wires[0].classList.remove("hot"); wires[2].classList.remove("hot");
      agent.classList.remove("live");
      faceEl.innerHTML = face("happy", "hero-face");
      isl("rest", "Researcher answered");
      await ctx.sleep(4200);
    }
    async function loop() { for (;;) { await run.start(play); if (!hero.dataset.loop) return; } }

    if (reduce) final();
    else {
      reset();
      hero.dataset.loop = "1";
      let started = false;
      whenVisible(hero, (v) => { run.pause(!v); if (v && !started) { started = true; void loop(); } });
      hero.addEventListener("pointerenter", () => run.pause(true));
      hero.addEventListener("pointerleave", () => run.pause(false));
    }
    $("[data-replay]", hero)?.addEventListener("click", () => { run.stop(); hero.dataset.loop = "1"; void loop(); });
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
        const nd = $$(".nd", sc); const w = $$("path", sc); const lb = $$(".lbl", sc); const parts = $$(".part", sc);
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
    const hideBtn = $("[data-hide]", desk);
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
        const draw = () => { const n = Math.floor((Date.now() - t0) / 1000); top.innerHTML = `<span class="dot"></span><span>Researcher is working</span><span style="color:#8e8e93;font-variant-numeric:tabular-nums">0:${String(n % 60).padStart(2, "0")}</span>`; };
        draw(); timer = setInterval(draw, 500);
      }
    };
    const answer = (choice) => { say(choice === "once" ? "Allowed once. The agent carries on." : "Denied. The agent is told no."); state("rest"); };
    $$("[data-act]", pill).forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); auto = false; run.stop(); answer(b.dataset.act); }));
    $$("[data-do]", desk).forEach((b) => b.addEventListener("click", () => { auto = false; run.stop(); const d = b.dataset.do; if (d === "work") state("work"); else if (d === "ask") { cmd.textContent = "rm -rf ~/Projects/site/build"; state("ask"); } else state("rest"); }));
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

/* ---------- prism light, spotlight cards, reveals, the keys ---------- */
(() => {
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const SPECTRUM = ["#ff3b30", "#ff9500", "#ffd60a", "#30d158", "#64d2ff", "#0a84ff", "#bf5af2"];
  for (const el of $$("[data-prism]")) {
    let h = '<i class="core"></i><i class="beam soft"></i><i class="beam"></i>';
    SPECTRUM.forEach((c, i) => {
      const a = 4 + i * 4.2;
      const st = `--c:${c};--a:${a}deg;--d:${(-i * 1.3).toFixed(1)}s`;
      h += `<i class="fan" style="${st}"></i><i class="fan thin" style="${st}"></i>`;
    });
    el.innerHTML = h;
  }
  // the prism leans a little toward the pointer
  const hero = $$(".hero")[0]; const main = hero && $$(".prism", hero)[0];
  if (main && !reduce) {
    let tx = 0; let cx = 0;
    addEventListener("pointermove", (e) => { tx = (e.clientX / innerWidth - 0.5) * 6; }, { passive: true });
    const tick = () => { cx += (tx - cx) * 0.06; main.style.setProperty("--tilt", `${cx.toFixed(2)}deg`); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }
  // spotlight on cards
  for (const c of $$(".bc, .values > div, .os")) {
    c.addEventListener("pointermove", (e) => { const r = c.getBoundingClientRect(); c.style.setProperty("--mx", `${e.clientX - r.left}px`); c.style.setProperty("--my", `${e.clientY - r.top}px`); }, { passive: true });
  }
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
