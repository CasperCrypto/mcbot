/*
 * The launch video's timeline. `render(t)` draws the frame at t seconds from nothing but t, so a frame
 * rendered alone looks the same as in a run (render.ts screenshots one frame at a time). Scenes overlap by
 * 0.4 s so one leaves while the next arrives. Motion: damped springs for things that arrive, ease-out for
 * things that move, words that rise into place; no gradients, no glows (the website's rule).
 */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const F = window.McBotFoods;
  const LOGOS = window.LOGOS || {};

  /* ---------- easing ---------- */
  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  const prog = (t, at, dur) => clamp01((t - at) / dur);
  const outCubic = (p) => 1 - (1 - p) ** 3;
  const outQuint = (p) => 1 - (1 - p) ** 5;
  const inCubic = (p) => p * p * p;
  const inOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);
  /** A damped spring's way from 0 to 1, t seconds after it lets go. */
  function spring(t, f = 2.2, z = 0.62) {
    if (t <= 0) return 0;
    const w = 2 * Math.PI * f;
    const wd = w * Math.sqrt(1 - z * z);
    return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + ((z * w) / wd) * Math.sin(wd * t));
  }
  const lerp = (a, b, p) => a + (b - a) * p;
  const bump = (t, at, dur) => { const p = prog(t, at, dur); return p <= 0 || p >= 1 ? 0 : Math.sin(Math.PI * p); };

  /* ---------- styles from numbers ---------- */
  function st(el, { o = 1, x = 0, y = 0, s = 1, blur = 0 } = {}) {
    el.style.opacity = String(Math.round(o * 1000) / 1000);
    el.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) scale(${s.toFixed(4)})`;
    el.style.filter = blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : "none";
  }
  /** Fades in while rising `dist` px. */
  function rise(el, t, at, { dur = 0.6, dist = 28, blur = 0, from = 1 } = {}) {
    const p = outCubic(prog(t, at, dur));
    st(el, { o: p, y: (1 - p) * dist, blur: (1 - p) * blur, s: lerp(from, 1, p) });
    return p;
  }
  /** Arrives on a spring: scale from `from`, a little lift. */
  function pop(el, t, at, { f = 2.3, z = 0.58, from = 0.86, dist = 18 } = {}) {
    const k = spring(t - at, f, z);
    const o = outCubic(prog(t, at, 0.22));
    st(el, { o, s: lerp(from, 1, k), y: (1 - k) * dist });
    return k;
  }
  function hide(el) { st(el, { o: 0 }); }
  /** Words of a [data-words] line rise into place one after another. */
  function words(el, t, at, { stagger = 0.07, dur = 0.7, dist = 0.45, blur = 12 } = {}) {
    for (const [i, w] of el._w.entries()) {
      const p = outQuint(prog(t, at + i * stagger, dur));
      w.style.opacity = String(Math.round(p * 1000) / 1000);
      w.style.transform = `translateY(${((1 - p) * dist).toFixed(3)}em)`;
      w.style.filter = p < 0.995 ? `blur(${((1 - p) * blur).toFixed(2)}px)` : "none";
    }
  }
  function typeText(el, text, t, at, cps) {
    const n = Math.max(0, Math.min(text.length, Math.floor((t - at) * cps)));
    el.textContent = text.slice(0, n);
    return n;
  }
  const blinkOn = (t) => Math.floor(t * 1.9) % 2 === 0;

  /* ---------- the app's bots and brand marks ---------- */
  let uid = 0;
  const face = (name, size, expression = "idle") => F.foodSvg({ seed: `agent:${name}`, size, expression, uid: `v${uid++}`, title: "" });
  for (const el of $$("[data-agent]")) el.innerHTML = face(el.dataset.agent, Number(el.dataset.size || 48), el.dataset.exp || "idle");
  for (const el of $$("[data-mcbot]")) el.innerHTML = F.logoSvg(64, `logo${uid++}`, "");
  for (const el of $$("[data-logo]")) {
    const l = LOGOS[el.dataset.logo];
    if (!l) continue;
    if ("src" in l) {
      el.style.setProperty("--c", "#1c1c1f");
      el.innerHTML = `<img src="${l.src}" alt="">`;
    } else {
      el.style.setProperty("--c", l.tile ?? "#2a2a2f");
      el.innerHTML = `<svg viewBox="0 0 24 24"><path fill="${l.ink}"${l.rule ? ` fill-rule="${l.rule}"` : ""} d="${l.path}"/></svg>`;
    }
  }
  if (window.QR_SVG) $("#qr").innerHTML = window.QR_SVG;
  for (const el of $$("[data-words]")) {
    const parts = el.textContent.trim().split(/(\s+)/);
    el.textContent = "";
    el._w = [];
    for (let i = 0; i < parts.length; i += 2) {
      const w = document.createElement("span");
      w.className = "w";
      w.textContent = parts[i] + (parts[i + 1] ?? "");
      el.appendChild(w);
      el._w.push(w);
    }
  }

  /* ---------- the scenes: id, start and end, in seconds ---------- */
  const PLAN = [
    ["intro", 0, 4.4],
    ["describe", 4.0, 11.4],
    ["board", 11.0, 19.8],
    ["models", 19.4, 25.6],
    ["knowledge", 25.2, 32.2],
    ["ask", 31.8, 37.0],
    ["until", 36.6, 42.8],
    ["guard", 42.4, 47.8],
    ["train", 47.4, 53.6],
    ["share", 53.2, 58.6],
    ["end", 58.2, 64.5],
  ];
  const DURATION = 64.5;
  /** Each scene's content starts this long after the scene does, once the one before has gone. */
  const LEAD = 0.15;
  const scenes = Object.fromEntries(PLAN.map(([id, a, b]) => [id, { el: $(`#${id}`), a, b }]));

  /** A scene's own arrival and departure. */
  function frame(sc, t) {
    const dur = sc.b - sc.a;
    const p = outCubic(prog(t, 0.1, 0.45));
    const q = inCubic(prog(t, dur - 0.45, 0.45));
    sc.el.style.opacity = String(Math.round(p * (1 - q) * 1000) / 1000);
    sc.el.style.transform = `translateY(${((1 - p) * 24 - q * 34).toFixed(2)}px)`;
  }

  /* ---------- the pointer: waypoints in seconds and stage pixels; clicks press it ---------- */
  const centre = (el, dx = 0, dy = 0) => {
    const r = el.getBoundingClientRect();
    return [r.left + r.width / 2 + dx, r.top + r.height / 2 + dy];
  };
  let path = [];
  let clicks = [];
  function placePointer() {
    const S = (id) => scenes[id].a + LEAD;
    const at = (sel, dx = 0, dy = 0) => () => centre($(sel), dx, dy);
    path = [
      // Describe: to "Add to board"
      { t: S("describe") + 4.2, p: [1470, 960], o: 0 },
      { t: S("describe") + 4.5, p: [1440, 930], o: 1 },
      { t: S("describe") + 5.3, p: at("#plan-add", 18, 8), o: 1 },
      { t: S("describe") + 6.3, p: at("#plan-add", 50, 60), o: 1 },
      { t: S("describe") + 6.6, p: at("#plan-add", 60, 70), o: 0 },
      // Board: select the Researcher, then Compile
      { t: S("board") + 2.4, p: [960, 980], o: 0 },
      { t: S("board") + 2.6, p: [950, 960], o: 1 },
      { t: S("board") + 3.2, p: at('[data-n="a2"]', 40, 10), o: 1 },
      { t: S("board") + 3.6, p: at('[data-n="a2"]', 46, 14), o: 1 },
      { t: S("board") + 4.4, p: at("#compile-btn", 14, 6), o: 1 },
      { t: S("board") + 5.2, p: at("#compile-btn", 10, 90), o: 1 },
      { t: S("board") + 5.5, p: at("#compile-btn", 10, 110), o: 0 },
      // Models: open the picker, choose the local model
      { t: S("models") + 0.7, p: [1290, 760], o: 0 },
      { t: S("models") + 0.9, p: [1300, 730], o: 1 },
      { t: S("models") + 1.45, p: at("#mchip", 40, 6), o: 1 },
      { t: S("models") + 1.9, p: at("#mchip", 44, 10), o: 1 },
      { t: S("models") + 2.55, p: at('[data-mi="3"]', 10, 4), o: 1 },
      { t: S("models") + 3.5, p: at('[data-mi="3"]', 60, 60), o: 1 },
      { t: S("models") + 3.8, p: at('[data-mi="3"]', 70, 70), o: 0 },
      // Ask: choose "Calm"
      { t: S("ask") + 1.4, p: [1100, 880], o: 0 },
      { t: S("ask") + 1.6, p: [1080, 860], o: 1 },
      { t: S("ask") + 2.15, p: at('[data-qc="1"]', 8, 6), o: 1 },
      { t: S("ask") + 3.0, p: at('[data-qc="1"]', 70, 80), o: 1 },
      { t: S("ask") + 3.3, p: at('[data-qc="1"]', 80, 90), o: 0 },
      // Guardrails: allow once
      { t: S("guard") + 1.0, p: [900, 860], o: 0 },
      { t: S("guard") + 1.2, p: [880, 840], o: 1 },
      { t: S("guard") + 1.75, p: at("#appr-allow", 10, 6), o: 1 },
      { t: S("guard") + 2.5, p: at("#appr-allow", 60, 70), o: 1 },
      { t: S("guard") + 2.8, p: at("#appr-allow", 70, 80), o: 0 },
      // Training: use the new model
      { t: S("train") + 3.2, p: [1640, 760], o: 0 },
      { t: S("train") + 3.4, p: [1620, 740], o: 1 },
      { t: S("train") + 3.95, p: at("#train-use", 6, 4), o: 1 },
      { t: S("train") + 4.6, p: at("#train-use", 40, 60), o: 1 },
      { t: S("train") + 4.9, p: at("#train-use", 50, 70), o: 0 },
    ];
    clicks = [S("describe") + 5.4, S("board") + 3.3, S("board") + 4.5, S("models") + 1.55, S("models") + 2.65, S("ask") + 2.25, S("guard") + 1.85, S("train") + 4.05];
  }
  function pointer(t) {
    const el = $("#cursor");
    let i = path.findIndex((w) => w.t > t);
    if (i <= 0) { el.style.opacity = "0"; return; }
    const a = path[i - 1];
    const b = path[i];
    // A gap of more than a second between two waypoints is a different scene: stay hidden.
    if (b.t - a.t > 1.6) { el.style.opacity = "0"; return; }
    const A = typeof a.p === "function" ? a.p() : a.p;
    const B = typeof b.p === "function" ? b.p() : b.p;
    const p = inOut(prog(t, a.t, b.t - a.t));
    const arc = Math.sin(Math.PI * p) * Math.min(40, Math.hypot(B[0] - A[0], B[1] - A[1]) * 0.12);
    const x = lerp(A[0], B[0], p) + arc * 0.4;
    const y = lerp(A[1], B[1], p) - arc;
    const o = lerp(a.o, b.o, p);
    const press = Math.max(...clicks.map((c) => bump(t, c - 0.06, 0.2)));
    el.style.opacity = String(Math.round(o * 1000) / 1000);
    el.style.transform = `translate(${(x - 3).toFixed(1)}px, ${(y - 2).toFixed(1)}px) scale(${(1 - press * 0.14).toFixed(3)})`;
    el.style.transformOrigin = "3px 2px";
  }
  const pressed = (t, c) => bump(t, c - 0.04, 0.22);

  /* ---------- the eyes of the burger ---------- */
  function eyes(bot, t, look, blinks) {
    const [ex, ey] = look(t);
    const b = Math.max(0, ...blinks.map((at) => bump(t, at, 0.16)));
    bot.style.setProperty("--ex", ex.toFixed(3));
    bot.style.setProperty("--ey", ey.toFixed(3));
    bot.style.setProperty("--blink", (1 - b * 0.9).toFixed(3));
  }
  /** A gaze that moves between points [t, ex, ey] with ease. */
  const gaze = (pts) => (t) => {
    let i = pts.findIndex((p) => p[0] > t);
    if (i === -1) return [pts.at(-1)[1], pts.at(-1)[2]];
    if (i === 0) return [pts[0][1], pts[0][2]];
    const a = pts[i - 1];
    const b = pts[i];
    const p = inOut(prog(t, a[0], b[0] - a[0]));
    return [lerp(a[1], b[1], p), lerp(a[2], b[2], p)];
  };

  /* ---------- each scene, drawn at its own time t (0 = its start) ---------- */
  const draw = {
    intro(t, el) {
      const bot = $("#intro-bot", el);
      const k = spring(t - 0.15, 1.6, 0.52);
      st(bot, { o: outCubic(prog(t, 0.15, 0.4)), s: lerp(0.62, 1, k), y: (1 - k) * 40 });
      eyes(bot, t, gaze([[0, 0, 0], [0.9, 0, 0], [1.3, -0.7, -0.3], [2.0, -0.7, -0.3], [2.4, 0.7, -0.1], [3.0, 0.7, -0.1], [3.4, 0, 0.55]]), [1.75, 3.6]);
      rise($("#intro-name", el), t, 0.7, { dist: 16 });
      words($("#intro-hl", el), t, 1.0, { stagger: 0.09, dur: 0.8 });
    },

    describe(t, el) {
      words($(".hl", el), t, 0.15);
      const sheet = $("#ask-sheet", el);
      rise(sheet, t, 0.3, { dist: 46, from: 0.985 });
      sheet.style.transform += ` scale(${lerp(1, 1.012, inOut(prog(t, 1, 6))).toFixed(4)})`;
      const text = "A support team that answers customers on Slack, from our docs";
      const n = typeText($("#ask-text", el), text, t, 0.95, 31);
      $("#ask-ph", el).style.display = n ? "none" : "";
      $("#ask-caret", el).style.opacity = t < 3.1 && (n < text.length || blinkOn(t)) ? "1" : "0";
      $$(".pc", el).forEach((c, i) => pop(c, t, 3.15 + i * 0.13, { from: 0.9, dist: 30 }));
      rise($("#plan-note", el), t, 3.6, { dist: 8 });
      rise($("#plan-cancel", el), t, 3.65, { dist: 8 });
      const add = $("#plan-add", el);
      rise(add, t, 3.7, { dist: 8 });
      const pr = pressed(t, 5.4);
      const done = t >= 5.48;
      add.textContent = done ? "Added to the board ✓" : "Add to board";
      add.style.transform += ` scale(${(1 - pr * 0.05).toFixed(3)})`;
    },

    board(t, el) {
      words($(".hl", el), t, 0.15);
      const s1 = $("#board-sub-1", el);
      const s2 = $("#board-sub-2", el);
      words(s1, t, 0.45);
      const swap = inCubic(prog(t, 4.6, 0.3));
      s1.style.opacity = String(1 - swap);
      s2.style.opacity = t >= 4.85 ? "1" : "0";
      if (t >= 4.85) words(s2, t, 4.85, { stagger: 0.05 });
      const win = $("#board-win", el);
      rise(win, t, 0.3, { dist: 60, from: 0.985 });
      win.style.transform += ` scale(${lerp(1, 1.022, inOut(prog(t, 1.2, 7.2))).toFixed(4)})`;
      const order = ["m1", "m2", "a1", "a2", "a3", "t1", "t2", "t3"];
      order.forEach((n, i) => pop($(`[data-n="${n}"]`, el), t, 0.85 + i * 0.09, { from: 0.8, dist: 14 }));
      // Wires draw themselves once the blocks are down.
      for (const [i, w] of wires.entries()) {
        const p = outCubic(prog(t, 1.45 + i * 0.07, 0.65));
        w.el.style.strokeDashoffset = String(w.len * (1 - p));
        w.el.style.opacity = p > 0 ? "1" : "0";
      }
      // Choosing the Researcher says what its wires mean.
      const sel = t >= 3.3 && t < 4.9;
      $('[data-n="a2"]', el).classList.toggle("sel", sel);
      const lab = outCubic(prog(t, 3.35, 0.35)) * (1 - prog(t, 4.75, 0.2));
      $$(".wl", el).forEach((l, i) => st(l, { o: lab * outCubic(prog(t, 3.35 + i * 0.05, 0.3)), y: (1 - lab) * 6 }));
      // Compile, then the real files.
      const cb = $("#compile-btn", el);
      cb.style.transform = `scale(${(1 - pressed(t, 4.5) * 0.06).toFixed(3)})`;
      $("#compile-label", el).textContent = t < 4.52 ? "Compile" : t < 4.95 ? "Compiling…" : "Compiled ✓";
      const files = $("#files", el);
      const fp = outCubic(prog(t, 4.95, 0.5));
      st(files, { o: fp, x: (1 - fp) * 70 });
      $$(".f", files).forEach((f, i) => rise(f, t, 5.25 + i * 0.16, { dist: 10 }));
      rise($("#files-done", files), t, 6.05, { dist: 8 });
    },

    models(t, el) {
      words($(".hl", el), t, 0.15);
      words($(".sub", el), t, 0.45, { stagger: 0.05 });
      rise($("#mod-card", el), t, 0.3, { dist: 44, from: 0.985 });
      const chip = $("#mchip", el);
      const local = t >= 2.72;
      const sw = spring(t - 2.72, 2.6, 0.5);
      chip.style.transform = `scale(${(local ? lerp(0.94, 1, sw) : 1 - pressed(t, 1.55) * 0.05).toFixed(4)})`;
      const logo = $("#mchip-logo", el);
      if (logo.dataset.logo !== (local ? "ollama" : "claude")) {
        logo.dataset.logo = local ? "ollama" : "claude";
        const l = LOGOS[logo.dataset.logo];
        if (l && !("src" in l)) {
          logo.style.setProperty("--c", l.tile ?? "#2a2a2f");
          logo.innerHTML = `<svg viewBox="0 0 24 24"><path fill="${l.ink}" d="${l.path}"/></svg>`;
        }
      }
      $("#mchip-name", el).textContent = local ? "Llama 3.3" : "Claude Sonnet 4.5";
      $("#mchip-where", el).textContent = local ? "On this computer · Free" : "Cloud · through OpenRouter";
      // The menu, under the chip.
      const menu = $("#mod-menu", el);
      const open = t >= 1.6 && t < 2.85;
      if (open) {
        const k = spring(t - 1.6, 2.8, 0.7);
        const shut = prog(t, 2.7, 0.15);
        st(menu, { o: outCubic(prog(t, 1.6, 0.15)) * (1 - shut), s: lerp(0.94, 1, k), y: (1 - k) * -10 });
      } else hide(menu);
      const hover = t >= 2.25 ? 3 : 0;
      $$(".mi", menu).forEach((m) => m.classList.toggle("on", Number(m.dataset.mi) === hover));
      $$(".kp", el).forEach((k, i) => pop(k, t, 3.1 + i * 0.1, { from: 0.92, dist: 16 }));
    },

    knowledge(t, el) {
      words($(".hl", el), t, 0.15);
      words($(".sub", el), t, 0.45, { stagger: 0.045 });
      rise($("#kn-docs", el), t, 0.3, { dist: 44 });
      rise($("#kn-chat", el), t, 0.42, { dist: 44 });
      $$(".doc", el).forEach((d, i) => {
        const at = 0.85 + i * 0.28;
        const k = spring(t - at, 2.1, 0.6);
        st(d, { o: outCubic(prog(t, at, 0.3)), y: (1 - k) * -46, s: lerp(1.04, 1, k) });
      });
      rise($("#kn-q", el), t, 2.0, { dist: 18 });
      rise($("#kn-who", el), t, 2.5, { dist: 10 });
      const dots = $("#kn-dots", el);
      const thinking = t >= 2.55 && t < 3.45;
      dots.style.opacity = thinking ? "1" : "0";
      $$("i", dots).forEach((d, i) => { d.style.opacity = String(0.3 + 0.7 * bump((t * 1.6 + i * 0.22) % 1, 0, 1)); });
      const a = $("#kn-a", el);
      rise(a, t, 3.45, { dist: 14 });
      rise($(".cite", a), t, 3.95, { dist: 8 });
    },

    ask(t, el) {
      words($(".hl", el), t, 0.15);
      words($(".sub", el), t, 0.45, { stagger: 0.05 });
      rise($("#ask-chat", el), t, 0.25, { dist: 44 });
      rise($("#ask-me", el), t, 0.5, { dist: 16 });
      rise($("#ask-who", el), t, 0.95, { dist: 10 });
      pop($("#ask-q", el), t, 1.0, { from: 0.96, dist: 16 });
      const chose = t >= 2.3;
      $$(".qc", el).forEach((c) => {
        const me = c.dataset.qc === "1";
        c.classList.toggle("pick", chose && me);
        c.style.opacity = chose && !me ? "0.35" : "1";
        c.style.transform = me ? `scale(${(1 - pressed(t, 2.25) * 0.07).toFixed(3)})` : "none";
      });
      rise($("#ask-who2", el), t, 2.75, { dist: 10 });
      rise($("#ask-a", el), t, 2.85, { dist: 14 });
    },

    until(t, el) {
      words($(".hl", el), t, 0.15);
      words($(".sub", el), t, 0.45, { stagger: 0.05 });
      rise($("#task", el), t, 0.3, { dist: 44 });
      const R = [[0.75, 1.35, 1.75], [1.95, 2.55, 2.95], [3.15, 3.75, 4.15]];
      let state = "Working";
      $$(".round", el).forEach((r, i) => {
        const [come, check, judged] = R[i];
        pop(r, t, come, { from: 0.94, dist: 16 });
        if (t >= check && t < judged) state = "Checking";
        else if (t >= come && t < check) state = "Working";
        const v = $(".v", r);
        v.style.opacity = String(outCubic(prog(t, judged, 0.25)));
      });
      const done = t >= R[2][2];
      const s = $("#task-state", el);
      s.textContent = done ? "Ready for review" : state;
      s.classList.toggle("done", done);
      $("#task-face-w", el).style.opacity = done ? "0" : "1";
      $("#task-face-h", el).style.opacity = done ? "1" : "0";
      rise($("#task-foot", el), t, 4.45, { dist: 10 });
    },

    guard(t, el) {
      words($(".hl", el), t, 0.15);
      words($(".sub", el), t, 0.45, { stagger: 0.05 });
      const a = $("#appr", el);
      rise(a, t, 0.35, { dist: 44 });
      const done = t >= 1.95;
      a.classList.toggle("done", done);
      const row = $("#appr-row", el);
      const gone = outCubic(prog(t, 1.95, 0.2));
      st(row, { o: 1 - gone, y: -gone * 8 });
      rise($("#appr-ok", el), t, 2.0, { dist: 10 });
      $("#appr-allow", el).style.transform = `scale(${(1 - pressed(t, 1.85) * 0.06).toFixed(3)})`;
      $$(".gd", el).forEach((g, i) => pop(g, t, 2.45 + i * 0.1, { from: 0.92, dist: 16 }));
    },

    train(t, el) {
      words($(".hl", el), t, 0.15);
      words($(".sub", el), t, 0.45, { stagger: 0.045 });
      const steps = $$(".step", el);
      steps.forEach((s, i) => pop(s, t, 0.5 + i * 0.22, { from: 0.92, dist: 20 }));
      $("#train-bar", el).style.width = `${(inOut(prog(t, 1.25, 1.8)) * 100).toFixed(2)}%`;
      const ready = t >= 3.1;
      const last = steps[2];
      last.classList.toggle("ready", ready);
      if (!ready) last.style.opacity = String(Math.min(Number(last.style.opacity || 0), 0.35));
      else last.style.transform = `scale(${lerp(1.03, 1, spring(t - 3.1, 2.6, 0.5)).toFixed(4)})`;
      $("#train-use", el).style.transform = `scale(${(1 - pressed(t, 4.05) * 0.07).toFixed(3)})`;
      pop($("#train-toast", el), t, 4.2, { from: 0.9, dist: 22 });
    },

    share(t, el) {
      words($(".hl", el), t, 0.15);
      words($(".sub", el), t, 0.45, { stagger: 0.05 });
      rise($("#share-card", el), t, 0.3, { dist: 44 });
      const g = t >= 1.1;
      $("#seg-a", el).classList.toggle("on", !g);
      $("#seg-b", el).classList.toggle("on", g);
      pop($("#qr", el), t, 0.75, { from: 0.8, dist: 0 });
      $$(".pa", el).forEach((p, i) => pop(p, t, 1.0 + i * 0.1, { from: 0.6, dist: 0 }));
      const ph = $("#phone", el);
      const k = spring(t - 1.0, 1.7, 0.66);
      st(ph, { o: outCubic(prog(t, 1.0, 0.3)), x: (1 - k) * 160, y: (1 - k) * 30 });
      rise($("#ph-q", el), t, 2.0, { dist: 14 });
      rise($("#ph-a", el), t, 2.75, { dist: 14 });
      rise($("#ph-q2", el), t, 3.45, { dist: 14 });
    },

    end(t, el) {
      const bot = $("#end-bot", el);
      const k = spring(t - 0.1, 1.7, 0.55);
      st(bot, { o: outCubic(prog(t, 0.1, 0.35)), s: lerp(0.7, 1, k), y: (1 - k) * 30 });
      eyes(bot, t, gaze([[0, 0, 0.4], [1.2, 0, 0.4], [1.6, 0, 0], [3.8, 0, 0], [4.2, 0.5, 0.2]]), [2.3, 4.9]);
      words($(".end-name", el), t, 0.45, { stagger: 0.1, dur: 0.8 });
      words($(".end-line", el), t, 0.95, { stagger: 0.035 });
      $$("#end-cta .btn", el).forEach((b, i) => pop(b, t, 1.45 + i * 0.12, { from: 0.9, dist: 14 }));
    },
  };

  /* ---------- wires on the board: measured once, drawn by the clock ---------- */
  const wires = [];
  function measureWires() {
    const body = $("#board-body");
    const svg = $("#wires");
    const box = (n) => {
      const el = $(`[data-n="${n}"]`, body);
      return { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
    };
    const side = (a, b) => {
      const A = box(a);
      const B = box(b);
      const x1 = A.x + A.w;
      const y1 = A.y + A.h / 2;
      const x2 = B.x;
      const y2 = B.y + B.h / 2;
      const d = (x2 - x1) * 0.5;
      return { d: `M${x1} ${y1}C${x1 + d} ${y1} ${x2 - d} ${y2} ${x2} ${y2}`, mid: [(x1 + x2) / 2, (y1 + y2) / 2] };
    };
    const down = (a, b) => {
      const A = box(a);
      const B = box(b);
      const x = A.x + A.w / 2;
      return { d: `M${x} ${A.y + A.h}L${x} ${B.y}`, mid: [x, (A.y + A.h + B.y) / 2] };
    };
    const list = [
      ["m1-a1", side("m1", "a1")], ["m1-a2", side("m1", "a2")], ["m1-a3", side("m1", "a3")], ["m2-a2", side("m2", "a2"), "back"],
      ["a1-t1", side("a1", "t1")], ["a2-t2", side("a2", "t2")], ["a3-t3", side("a3", "t3")],
      ["a1-a2", down("a1", "a2")], ["a2-a3", down("a2", "a3")],
    ];
    svg.innerHTML = list.map(([id, w, cls]) => `<path data-w="${id}" class="${cls ?? ""}" d="${w.d}"/>`).join("");
    for (const [id, w] of list) {
      const el = $(`[data-w="${id}"]`, svg);
      const len = el.getTotalLength();
      if (!el.classList.contains("back")) el.style.strokeDasharray = `${len}`;
      wires.push({ el, len });
      const label = $(`[data-wl="${id}"]`, body);
      if (label) {
        label.style.left = `${w.mid[0] - label.offsetWidth / 2}px`;
        label.style.top = `${w.mid[1] - label.offsetHeight / 2}px`;
      }
    }
  }

  /* ---------- CSS animations (the bots blink and think) follow the clock too ---------- */
  function animationsAt(t) {
    for (const a of document.getAnimations()) {
      a.pause();
      const timing = a.effect?.getComputedTiming?.();
      if (timing && timing.iterations === Infinity) a.currentTime = t * 1000;
      else if (timing && Number.isFinite(timing.endTime)) a.currentTime = timing.endTime;
    }
  }

  function render(T) {
    for (const [id, sc] of Object.entries(scenes)) {
      const t = T - sc.a;
      const on = T >= sc.a && T < sc.b;
      sc.el.style.visibility = on ? "visible" : "hidden";
      if (!on) continue;
      frame(sc, t);
      draw[id](t - LEAD, sc.el);
    }
    // The last half second fades to black, so the video loops cleanly.
    $("#stage").style.opacity = String(1 - prog(T, DURATION - 0.5, 0.5));
    pointer(T);
    animationsAt(T);
  }

  let ready = false;
  function setup() {
    if (ready) return;
    ready = true;
    for (const sc of Object.values(scenes)) sc.el.style.visibility = "visible";
    measureWires();
    // The menu sits under the model chip.
    const chip = $("#mchip").getBoundingClientRect();
    const menu = $("#mod-menu");
    menu.style.left = `${chip.right - menu.offsetWidth}px`;
    menu.style.top = `${chip.bottom + 12}px`;
    menu.style.transformOrigin = "top right";
    // The rows that are centred by their content.
    for (const id of ["#kept", "#guards"]) {
      const el = $(id);
      el.style.left = `${(1920 - el.offsetWidth) / 2}px`;
    }
    placePointer();
    for (const sc of Object.values(scenes)) sc.el.style.visibility = "hidden";
  }

  window.VIDEO = {
    duration: DURATION,
    setup,
    render(T) { setup(); render(T); },
  };

  // Opened in a browser: play it (or hold #t=12.5).
  if (!window.__RENDERING__) {
    document.fonts.ready.then(() => {
      setup();
      const hold = /#t=([\d.]+)/.exec(location.hash);
      if (hold) return render(Number(hold[1]));
      const t0 = performance.now();
      const tick = () => { render(((performance.now() - t0) / 1000) % DURATION); requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
  }
})();
