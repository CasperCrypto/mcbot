/*
 * The launch video's timeline, cut to a 120 BPM soundtrack (a beat is 0.5 s, a bar 2 s). `render(t)` draws the
 * frame at t seconds from nothing but t, so a frame rendered alone looks the same as in a run. Every moment that
 * makes a sound (a click, a card, a letter typed, a cut, a drop) is also a cue in VIDEO.score, which also says
 * where the build, the drops and the break fall: audio.py makes the soundtrack from it, so picture and sound
 * come from the same numbers. No gradients, no glows (the website's rule).
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
  const outExpo = (p) => (p >= 1 ? 1 : 1 - 2 ** (-10 * p));
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
  const BEAT = 0.5;

  /* ---------- styles from numbers ---------- */
  const r3 = (v) => String(Math.round(v * 1000) / 1000);
  function st(el, { o = 1, x = 0, y = 0, s = 1, blur = 0 } = {}) {
    el.style.opacity = r3(o);
    el.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) scale(${s.toFixed(4)})`;
    el.style.filter = blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : "none";
  }
  function rise(el, t, at, { dur = 0.45, dist = 26, blur = 0, from = 1 } = {}) {
    const p = outQuint(prog(t, at, dur));
    st(el, { o: p, y: (1 - p) * dist, blur: (1 - p) * blur, s: lerp(from, 1, p) });
    return p;
  }
  function pop(el, t, at, { f = 2.6, z = 0.55, from = 0.82, dist = 18 } = {}) {
    const k = spring(t - at, f, z);
    st(el, { o: outCubic(prog(t, at, 0.12)), s: lerp(from, 1, k), y: (1 - k) * dist });
    return k;
  }
  const hide = (el) => st(el, { o: 0 });
  /** Words land one after another: each punches in from a little larger, sharpening as it lands. */
  function words(el, t, at, { stagger = 0.09, dur = 0.38, from = 1.16, blur = 12 } = {}) {
    for (const [i, w] of el._w.entries()) {
      const p = outExpo(prog(t, at + i * stagger, dur));
      w.style.opacity = r3(clamp01(p * 1.6));
      w.style.transform = `translateY(${((1 - p) * 0.18).toFixed(3)}em) scale(${lerp(from, 1, p).toFixed(4)})`;
      w.style.filter = p < 0.995 ? `blur(${((1 - p) * blur).toFixed(2)}px)` : "none";
    }
  }
  /** A big word that punches in at `at` and is cut at `out`. */
  function punch(el, t, at, out, { from = 1.3 } = {}) {
    if (t < at || t >= out) return hide(el);
    const p = outExpo(prog(t, at, 0.28));
    st(el, { o: clamp01(p * 2), s: lerp(from, 1, p) * (1 + (t - at) * 0.025), blur: (1 - p) * 16 });
  }
  function typeText(el, text, t, at, cps) {
    const n = Math.max(0, Math.min(text.length, Math.floor((t - at) * cps)));
    el.textContent = text.slice(0, n);
    return n;
  }
  const blinkOn = (t) => Math.floor(t * 1.9) % 2 === 0;
  const pressed = (t, c) => bump(t, c - 0.04, 0.2);

  /* ---------- the app's bots and brand marks ---------- */
  let uid = 0;
  const face = (name, size, expression = "idle") => F.foodSvg({ seed: `agent:${name}`, size, expression, uid: `v${uid++}`, title: "" });
  for (const el of $$("[data-agent]")) el.innerHTML = face(el.dataset.agent, Number(el.dataset.size || 48), el.dataset.exp || "idle");
  for (const el of $$("[data-mcbot]")) el.innerHTML = F.logoSvg(64, `logo${uid++}`, "");
  const paintLogo = (el, key) => {
    const l = LOGOS[key];
    if (!l) return;
    if ("src" in l) {
      el.style.setProperty("--c", "#1c1c1f");
      el.innerHTML = `<img src="${l.src}" alt="">`;
    } else {
      el.style.setProperty("--c", l.tile ?? "#2a2a2f");
      el.innerHTML = `<svg viewBox="0 0 24 24"><path fill="${l.ink}"${l.rule ? ` fill-rule="${l.rule}"` : ""} d="${l.path}"/></svg>`;
    }
  };
  for (const el of $$("[data-logo]")) paintLogo(el, el.dataset.logo);
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

  /* ---------- the cut: scenes on bar lines, and how each one comes in ---------- */
  const PLAN = [
    // id, start, end, how it arrives ("cut" = on a drop or straight in, no transition of its own)
    ["open", 0, 4, "cut"],
    ["intro", 4, 8, "cut"],
    ["describe", 8, 14, "zoom"],
    ["board", 14, 20, "slide"],
    ["models", 20, 24, "zoom"],
    ["knowledge", 24, 28, "slide"],
    ["ask", 28, 32, "zoom"],
    ["until", 32, 36, "slide"],
    ["guard", 36, 40, "zoom"],
    ["train", 40, 44, "cut"],
    ["share", 44, 48, "slide"],
    ["montage", 48, 54, "zoom"],
    ["end", 54, 62, "cut"],
  ];
  const DURATION = 62;
  const DROPS = [4, 40, 54];
  const TAIL = 0.1;
  const scenes = Object.fromEntries(PLAN.map(([id, a, b, how], i) => [id, { id, el: $(`#${id}`), a, b, how, next: PLAN[i + 1]?.[3] ?? "cut" }]));

  /** A scene arrives the way its plan says and leaves the way the next one arrives (into a drop: forward, fast). */
  function frame(sc, t) {
    const dur = sc.b - sc.a;
    let o = 1;
    let x = 0;
    let s = 1;
    let blur = 0;
    if (sc.how === "zoom" || sc.how === "slide") {
      const p = outExpo(prog(t, 0, 0.5));
      o *= clamp01(p * 2.5);
      blur += (1 - p) * 11;
      if (sc.how === "zoom") s *= lerp(0.88, 1, p);
      else x += (1 - p) * 260;
    }
    if (sc.id !== "open" && sc.id !== "end") {
      const q = inCubic(prog(t, dur - 0.28, 0.28 + TAIL));
      if (sc.next === "slide") { x -= q * 260; blur += q * 10; } else { s *= lerp(1, 1.16, q); blur += q * 14; }
      o *= 1 - q;
    }
    sc.el.style.opacity = r3(o);
    sc.el.style.transform = `translateX(${x.toFixed(2)}px) scale(${s.toFixed(4)})`;
    sc.el.style.filter = blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : "none";
  }

  /* ---------- the cues the soundtrack follows ---------- */
  const cues = [];
  const cue = (t, kind, extra = {}) => cues.push({ t: Math.round(t * 1000) / 1000, kind, ...extra });

  /* ---------- the pointer: waypoints in seconds and stage pixels; clicks press it ---------- */
  const centre = (el, dx = 0, dy = 0) => {
    const r = el.getBoundingClientRect();
    return [r.left + r.width / 2 + dx, r.top + r.height / 2 + dy];
  };
  let path = [];
  let clicks = [];
  function pointerPlan() {
    const S = (id) => scenes[id].a;
    const at = (sel, dx = 0, dy = 0) => () => centre($(sel), dx, dy);
    path = [
      { t: S("describe") + 3.2, p: [1470, 960], o: 0 },
      { t: S("describe") + 3.4, p: [1440, 930], o: 1 },
      { t: S("describe") + 3.9, p: at("#plan-add", 18, 8), o: 1 },
      { t: S("describe") + 4.6, p: at("#plan-add", 50, 60), o: 1 },
      { t: S("describe") + 4.9, p: at("#plan-add", 60, 70), o: 0 },

      { t: S("board") + 1.8, p: [950, 980], o: 0 },
      { t: S("board") + 1.95, p: [950, 960], o: 1 },
      { t: S("board") + 2.4, p: at('[data-n="a2"]', 40, 10), o: 1 },
      { t: S("board") + 2.7, p: at('[data-n="a2"]', 46, 14), o: 1 },
      { t: S("board") + 3.4, p: at("#compile-btn", 14, 6), o: 1 },
      { t: S("board") + 4.1, p: at("#compile-btn", 10, 90), o: 1 },
      { t: S("board") + 4.4, p: at("#compile-btn", 10, 110), o: 0 },

      { t: S("models") + 0.3, p: [1290, 760], o: 0 },
      { t: S("models") + 0.45, p: [1300, 730], o: 1 },
      { t: S("models") + 0.95, p: at("#mchip", 40, 6), o: 1 },
      { t: S("models") + 1.15, p: at("#mchip", 44, 10), o: 1 },
      { t: S("models") + 1.45, p: at('[data-mi="3"]', 10, 4), o: 1 },
      { t: S("models") + 2.1, p: at('[data-mi="3"]', 60, 60), o: 1 },
      { t: S("models") + 2.4, p: at('[data-mi="3"]', 70, 70), o: 0 },

      { t: S("ask") + 0.85, p: [1100, 880], o: 0 },
      { t: S("ask") + 1.0, p: at('[data-qc="1"]', 140, 120), o: 1 },
      { t: S("ask") + 1.45, p: at('[data-qc="1"]', 8, 6), o: 1 },
      { t: S("ask") + 2.1, p: at('[data-qc="1"]', 70, 80), o: 1 },
      { t: S("ask") + 2.35, p: at('[data-qc="1"]', 80, 90), o: 0 },

      { t: S("guard") + 0.55, p: [900, 860], o: 0 },
      { t: S("guard") + 0.7, p: at("#appr-allow", 120, 140), o: 1 },
      { t: S("guard") + 1.2, p: at("#appr-allow", 10, 6), o: 1 },
      { t: S("guard") + 1.8, p: at("#appr-allow", 60, 70), o: 1 },
      { t: S("guard") + 2.05, p: at("#appr-allow", 70, 80), o: 0 },

      { t: S("train") + 1.95, p: [1640, 760], o: 0 },
      { t: S("train") + 2.1, p: at("#train-use", 110, 120), o: 1 },
      { t: S("train") + 2.5, p: at("#train-use", 6, 4), o: 1 },
      { t: S("train") + 3.1, p: at("#train-use", 40, 60), o: 1 },
      { t: S("train") + 3.35, p: at("#train-use", 50, 70), o: 0 },
    ];
    clicks = [S("describe") + 4.0, S("board") + 2.5, S("board") + 3.5, S("models") + 1.0, S("models") + 1.5, S("ask") + 1.5, S("guard") + 1.25, S("train") + 2.6];
  }
  function pointer(t) {
    const el = $("#cursor");
    const i = path.findIndex((w) => w.t > t);
    if (i <= 0) { el.style.opacity = "0"; return; }
    const a = path[i - 1];
    const b = path[i];
    if (b.t - a.t > 1.6) { el.style.opacity = "0"; return; }
    const A = typeof a.p === "function" ? a.p() : a.p;
    const B = typeof b.p === "function" ? b.p() : b.p;
    const p = inOut(prog(t, a.t, b.t - a.t));
    const arc = Math.sin(Math.PI * p) * Math.min(40, Math.hypot(B[0] - A[0], B[1] - A[1]) * 0.12);
    const x = lerp(A[0], B[0], p) + arc * 0.4;
    const y = lerp(A[1], B[1], p) - arc;
    const press = Math.max(0, ...clicks.map((c) => bump(t, c - 0.06, 0.2)));
    el.style.opacity = r3(lerp(a.o, b.o, p));
    el.style.transform = `translate(${(x - 3).toFixed(1)}px, ${(y - 2).toFixed(1)}px) scale(${(1 - press * 0.14).toFixed(3)})`;
    el.style.transformOrigin = "3px 2px";
  }

  /* ---------- the burger's eyes ---------- */
  function eyes(bot, t, look, blinks) {
    const [ex, ey] = look(t);
    const b = Math.max(0, ...blinks.map((at) => bump(t, at, 0.16)));
    bot.style.setProperty("--ex", ex.toFixed(3));
    bot.style.setProperty("--ey", ey.toFixed(3));
    bot.style.setProperty("--blink", (1 - b * 0.9).toFixed(3));
  }
  const gaze = (pts) => (t) => {
    const i = pts.findIndex((p) => p[0] > t);
    if (i === -1) return [pts.at(-1)[1], pts.at(-1)[2]];
    if (i === 0) return [pts[0][1], pts[0][2]];
    const a = pts[i - 1];
    const b = pts[i];
    const p = inOut(prog(t, a[0], b[0] - a[0]));
    return [lerp(a[1], b[1], p), lerp(a[2], b[2], p)];
  };

  /* ---------- each scene at its own time t (0 = its start, on a bar line) ---------- */
  const SAY = [0.5, 1.5, 2.5];
  const FEAT = [3.0, 3.5, 4.0, 4.5, 5.0, 5.5];
  const TYPED = "A support team that answers customers on Slack, from our docs";
  const TYPE_AT = 0.75;
  const CPS = 40;
  const ROUNDS = [[0.45, 0.75, 1.0], [1.15, 1.45, 1.7], [1.85, 2.15, 2.4]];

  const draw = {
    open(t, el) {
      $$(".say", el).forEach((w, i) => {
        if (i < 2) return punch(w, t, SAY[i], SAY[i + 1] - 0.04);
        // The last one rushes into the camera, into the drop.
        if (t < SAY[2]) return hide(w);
        const p = outExpo(prog(t, SAY[2], 0.28));
        const rush = inCubic(prog(t, 3.25, 0.6));
        st(w, { o: clamp01(p * 2) * (1 - rush), s: lerp(1.3, 1, p) * lerp(1, 3.2, rush), blur: (1 - p) * 16 + rush * 22 });
      });
    },

    intro(t, el) {
      const bot = $("#intro-bot", el);
      const k = spring(t, 2.0, 0.42);
      st(bot, { o: outCubic(prog(t, 0, 0.06)), s: lerp(1.55, 1, k), y: (1 - k) * -30 });
      eyes(bot, t, gaze([[0, 0, 0.2], [0.9, 0, 0.2], [1.3, -0.7, -0.3], [2.0, -0.7, -0.3], [2.4, 0.7, -0.1], [2.9, 0.7, -0.1], [3.3, 0, 0.55]]), [1.9, 3.2]);
      rise($("#intro-name", el), t, 0.2, { dist: 14 });
      words($("#intro-hl", el), t, 0.25, { stagger: BEAT / 2, dur: 0.42, from: 1.3, blur: 16 });
      el.style.transform += ` scale(${lerp(1, 1.04, inOut(prog(t, 0, 4))).toFixed(4)})`;
    },

    describe(t, el) {
      words($(".hl", el), t, 0.12, { stagger: 0.1 });
      const sheet = $("#ask-sheet", el);
      rise(sheet, t, 0.15, { dist: 40, from: 0.985 });
      sheet.style.transform += ` scale(${lerp(1, 1.015, inOut(prog(t, 0.5, 5.5))).toFixed(4)})`;
      const n = typeText($("#ask-text", el), TYPED, t, TYPE_AT, CPS);
      $("#ask-ph", el).style.display = n ? "none" : "";
      $("#ask-caret", el).style.opacity = t < 2.45 && (n < TYPED.length || blinkOn(t)) ? "1" : "0";
      $$(".pc", el).forEach((c, i) => pop(c, t, 2.5 + i * BEAT / 2, { from: 0.86, dist: 30 }));
      rise($("#plan-note", el), t, 3.25, { dist: 8 });
      rise($("#plan-cancel", el), t, 3.3, { dist: 8 });
      const add = $("#plan-add", el);
      rise(add, t, 3.35, { dist: 8 });
      add.textContent = t >= 4.05 ? "Added to the board ✓" : "Add to board";
      add.style.transform += ` scale(${(1 - pressed(t, 4.0) * 0.06).toFixed(3)})`;
    },

    board(t, el) {
      words($(".hl", el), t, 0.12, { stagger: 0.1 });
      const s1 = $("#board-sub-1", el);
      const s2 = $("#board-sub-2", el);
      words(s1, t, 0.45, { stagger: 0.06 });
      s1.style.opacity = r3(1 - inCubic(prog(t, 3.6, 0.2)));
      s2.style.opacity = t >= 3.8 ? "1" : "0";
      if (t >= 3.8) words(s2, t, 3.8, { stagger: 0.05 });
      const win = $("#board-win", el);
      rise(win, t, 0.1, { dist: 50, from: 0.985 });
      win.style.transform += ` scale(${lerp(1, 1.022, inOut(prog(t, 1, 5))).toFixed(4)})`;
      ["m1", "m2", "a1", "a2", "a3", "t1", "t2", "t3"].forEach((n, i) => pop($(`[data-n="${n}"]`, el), t, 0.5 + i * 0.125, { from: 0.78, dist: 14 }));
      for (const [i, w] of wires.entries()) {
        const p = outCubic(prog(t, 1.25 + i * 0.05, 0.55));
        w.el.style.strokeDashoffset = String(w.len * (1 - p));
        w.el.style.opacity = p > 0 ? "1" : "0";
      }
      $('[data-n="a2"]', el).classList.toggle("sel", t >= 2.5 && t < 3.75);
      const lab = outCubic(prog(t, 2.55, 0.25)) * (1 - prog(t, 3.6, 0.15));
      $$(".wl", el).forEach((l, i) => st(l, { o: lab * outCubic(prog(t, 2.55 + i * 0.04, 0.2)), y: (1 - lab) * 6 }));
      $("#compile-btn", el).style.transform = `scale(${(1 - pressed(t, 3.5) * 0.06).toFixed(3)})`;
      $("#compile-label", el).textContent = t < 3.52 ? "Compile" : t < 3.75 ? "Compiling…" : "Compiled ✓";
      const files = $("#files", el);
      const fp = outExpo(prog(t, 3.75, 0.4));
      st(files, { o: clamp01(fp * 2), x: (1 - fp) * 80 });
      $$(".f", files).forEach((f, i) => rise(f, t, 4.0 + i * 0.125, { dist: 10 }));
      rise($("#files-done", files), t, 4.6, { dist: 8 });
    },

    models(t, el) {
      words($(".hl", el), t, 0.12, { stagger: 0.08 });
      words($(".sub", el), t, 0.4, { stagger: 0.04 });
      rise($("#mod-card", el), t, 0.1, { dist: 40, from: 0.985 });
      const chip = $("#mchip", el);
      const local = t >= 1.55;
      chip.style.transform = `scale(${(local ? lerp(0.92, 1, spring(t - 1.55, 2.8, 0.45)) : 1 - pressed(t, 1.0) * 0.05).toFixed(4)})`;
      const logo = $("#mchip-logo", el);
      const want = local ? "ollama" : "claude";
      if (logo.dataset.logo !== want) { logo.dataset.logo = want; paintLogo(logo, want); }
      $("#mchip-name", el).textContent = local ? "Llama 3.3" : "Claude Sonnet 4.5";
      $("#mchip-where", el).textContent = local ? "On this computer · Free" : "Cloud · through OpenRouter";
      const menu = $("#mod-menu", el);
      if (t >= 1.05 && t < 1.7) {
        const k = spring(t - 1.05, 3.0, 0.7);
        st(menu, { o: outCubic(prog(t, 1.05, 0.1)) * (1 - prog(t, 1.55, 0.12)), s: lerp(0.94, 1, k), y: (1 - k) * -10 });
      } else hide(menu);
      $$(".mi", menu).forEach((m) => m.classList.toggle("on", Number(m.dataset.mi) === (t >= 1.3 ? 3 : 0)));
      $$(".kp", el).forEach((k, i) => pop(k, t, 1.9 + i * 0.125, { from: 0.9, dist: 16 }));
    },

    knowledge(t, el) {
      words($(".hl", el), t, 0.12, { stagger: 0.08 });
      words($(".sub", el), t, 0.35, { stagger: 0.03 });
      rise($("#kn-docs", el), t, 0.1, { dist: 40 });
      rise($("#kn-chat", el), t, 0.18, { dist: 40 });
      $$(".doc", el).forEach((d, i) => {
        const at = 0.5 + i * 0.25;
        const k = spring(t - at, 2.4, 0.55);
        st(d, { o: outCubic(prog(t, at, 0.15)), y: (1 - k) * -46, s: lerp(1.05, 1, k) });
      });
      rise($("#kn-q", el), t, 1.25, { dist: 18 });
      rise($("#kn-who", el), t, 1.5, { dist: 10 });
      const dots = $("#kn-dots", el);
      dots.style.opacity = t >= 1.55 && t < 2.1 ? "1" : "0";
      $$("i", dots).forEach((d, i) => { d.style.opacity = r3(0.3 + 0.7 * bump((t * 2.2 + i * 0.22) % 1, 0, 1)); });
      const a = $("#kn-a", el);
      rise(a, t, 2.1, { dist: 14 });
      rise($(".cite", a), t, 2.4, { dist: 8 });
    },

    ask(t, el) {
      words($(".hl", el), t, 0.12, { stagger: 0.08 });
      words($(".sub", el), t, 0.35, { stagger: 0.04 });
      rise($("#ask-chat", el), t, 0.1, { dist: 40 });
      rise($("#ask-me", el), t, 0.3, { dist: 16 });
      rise($("#ask-who", el), t, 0.65, { dist: 10 });
      pop($("#ask-q", el), t, 0.65, { from: 0.94, dist: 16 });
      const chose = t >= 1.55;
      $$(".qc", el).forEach((c) => {
        const me = c.dataset.qc === "1";
        c.classList.toggle("pick", chose && me);
        c.style.opacity = chose && !me ? "0.35" : "1";
        c.style.transform = me ? `scale(${(1 - pressed(t, 1.5) * 0.08).toFixed(3)})` : "none";
      });
      rise($("#ask-who2", el), t, 1.9, { dist: 10 });
      rise($("#ask-a", el), t, 1.95, { dist: 14 });
    },

    until(t, el) {
      words($(".hl", el), t, 0.12, { stagger: 0.07 });
      words($(".sub", el), t, 0.35, { stagger: 0.04 });
      rise($("#task", el), t, 0.1, { dist: 40 });
      let state = "Working";
      $$(".round", el).forEach((r, i) => {
        const [come, check, judged] = ROUNDS[i];
        pop(r, t, come, { from: 0.92, dist: 16 });
        if (t >= check && t < judged) state = "Checking";
        $(".v", r).style.opacity = r3(outCubic(prog(t, judged, 0.15)));
      });
      const done = t >= ROUNDS[2][2];
      const s = $("#task-state", el);
      s.textContent = done ? "Ready for review" : state;
      s.classList.toggle("done", done);
      $("#task-face-w", el).style.opacity = done ? "0" : "1";
      $("#task-face-h", el).style.opacity = done ? "1" : "0";
      rise($("#task-foot", el), t, 2.6, { dist: 10 });
    },

    guard(t, el) {
      words($(".hl", el), t, 0.12, { stagger: 0.1 });
      words($(".sub", el), t, 0.4, { stagger: 0.05 });
      const a = $("#appr", el);
      rise(a, t, 0.15, { dist: 40 });
      a.classList.toggle("done", t >= 1.3);
      const gone = outCubic(prog(t, 1.3, 0.15));
      st($("#appr-row", el), { o: 1 - gone, y: -gone * 8 });
      rise($("#appr-ok", el), t, 1.33, { dist: 10 });
      $("#appr-allow", el).style.transform = `scale(${(1 - pressed(t, 1.25) * 0.06).toFixed(3)})`;
      $$(".gd", el).forEach((g, i) => pop(g, t, 1.75 + i * 0.125, { from: 0.9, dist: 16 }));
    },

    train(t, el) {
      words($(".hl", el), t, 0.1, { stagger: 0.07, from: 1.25 });
      words($(".sub", el), t, 0.35, { stagger: 0.03 });
      const steps = $$(".step", el);
      steps.forEach((s, i) => pop(s, t, 0.2 + i * 0.15, { from: 0.86, dist: 24 }));
      $("#train-bar", el).style.width = `${(inOut(prog(t, 0.65, 1.35)) * 100).toFixed(2)}%`;
      const ready = t >= 2.05;
      const last = steps[2];
      last.classList.toggle("ready", ready);
      if (!ready) last.style.opacity = r3(Math.min(Number(last.style.opacity || 0), 0.35));
      else last.style.transform = `scale(${lerp(1.04, 1, spring(t - 2.05, 2.8, 0.45)).toFixed(4)})`;
      $("#train-use", el).style.transform = `scale(${(1 - pressed(t, 2.6) * 0.07).toFixed(3)})`;
      pop($("#train-toast", el), t, 2.7, { from: 0.86, dist: 22 });
    },

    share(t, el) {
      words($(".hl", el), t, 0.12, { stagger: 0.08 });
      words($(".sub", el), t, 0.35, { stagger: 0.04 });
      rise($("#share-card", el), t, 0.1, { dist: 40 });
      $("#seg-a", el).classList.toggle("on", t < 0.6);
      $("#seg-b", el).classList.toggle("on", t >= 0.6);
      pop($("#qr", el), t, 0.45, { from: 0.75, dist: 0 });
      $$(".pa", el).forEach((p, i) => pop(p, t, 0.7 + i * 0.1, { from: 0.5, dist: 0 }));
      const k = spring(t - 0.75, 2.0, 0.6);
      st($("#phone", el), { o: outCubic(prog(t, 0.75, 0.2)), x: (1 - k) * 200, y: (1 - k) * 30 });
      rise($("#ph-q", el), t, 1.4, { dist: 14 });
      rise($("#ph-a", el), t, 2.0, { dist: 14 });
      rise($("#ph-q2", el), t, 2.6, { dist: 14 });
    },

    montage(t, el) {
      // Part one: the brand wall lands tile by tile; part two: a word a beat.
      const out = inCubic(prog(t, 2.75, 0.25));
      const hl = $("#mt-hl", el);
      words(hl, t, 0.1, { stagger: 0.07 });
      hl.style.opacity = r3(1 - out);
      const wall = $("#wall", el);
      wall.style.opacity = r3(1 - out);
      wall.style.transform = `scale(${(lerp(1, 1.05, inOut(prog(t, 0.3, 2.7))) * lerp(1, 1.25, out)).toFixed(4)})`;
      wall.style.filter = out > 0.01 ? `blur(${(out * 14).toFixed(2)}px)` : "none";
      $$(".tile", el).forEach((tile, i) => pop(tile, t, 0.3 + i * 0.05, { f: 3.0, z: 0.5, from: 0.4, dist: 30 }));
      $$("[data-feat]", el).forEach((w, i) => punch(w, t, FEAT[i], i < FEAT.length - 1 ? FEAT[i + 1] - 0.03 : 5.86, { from: 1.35 }));
    },

    end(t, el) {
      const bot = $("#end-bot", el);
      const k = spring(t, 1.9, 0.42);
      // A little bounce on every beat while the drums play.
      const beat = t < 4 ? Math.exp(-((t % BEAT) / 0.09)) * 0.018 : 0;
      st(bot, { o: outCubic(prog(t, 0, 0.06)), s: lerp(1.5, 1, k) * (1 + beat), y: (1 - k) * 30 });
      eyes(bot, t, gaze([[0, 0, 0.4], [1.2, 0, 0.4], [1.6, 0, 0], [3.8, 0, 0], [4.2, 0.5, 0.2]]), [2.6, 5.0]);
      words($(".end-name", el), t, 0.2, { stagger: BEAT / 2, dur: 0.45, from: 1.3, blur: 16 });
      words($(".end-line", el), t, 0.8, { stagger: 0.035 });
      $$("#end-cta .btn", el).forEach((b, i) => pop(b, t, 1.2 + i * 0.15, { from: 0.86, dist: 14 }));
    },
  };

  /* ---------- the sounds each scene makes, at the times it draws them ---------- */
  function scoreCues() {
    const S = (id) => scenes[id].a;
    SAY.forEach((t) => cue(t, "hit"));
    for (const d of DROPS) cue(d, "impact", { big: d !== 40 });
    for (const [, a, , how] of PLAN) if (how === "zoom" || how === "slide") cue(a, "whoosh", { dir: how === "slide" ? -1 : 1 });
    for (const c of clicks) cue(c, "click");
    // Describe: the letters, the cards, the board.
    for (let i = 0; i < TYPED.length; i++) if (TYPED[i] !== " ") cue(S("describe") + TYPE_AT + i / CPS, "type", { n: i });
    [0, 1, 2].forEach((i) => cue(S("describe") + 2.5 + i * BEAT / 2, "pop", { note: 4 + i }));
    cue(S("describe") + 4.05, "chime");
    // Board: blocks rise up the scale, wires zip, Compile, files.
    for (let i = 0; i < 8; i++) cue(S("board") + 0.5 + i * 0.125, "pop", { note: i, soft: true });
    cue(S("board") + 1.25, "zip");
    cue(S("board") + 3.75, "whoosh", { dir: -1, small: true });
    for (let i = 0; i < 4; i++) cue(S("board") + 4.0 + i * 0.125, "tick", { note: i });
    cue(S("board") + 4.6, "chime");
    // Models: the menu, the switch, what it keeps.
    cue(S("models") + 1.05, "pop", { note: 2, soft: true });
    cue(S("models") + 1.55, "chime");
    for (let i = 0; i < 4; i++) cue(S("models") + 1.9 + i * 0.125, "pop", { note: 3 + i, soft: true });
    // Knowledge: documents land, a question, an answer.
    for (let i = 0; i < 3; i++) cue(S("knowledge") + 0.5 + i * 0.25, "drop", { note: i });
    cue(S("knowledge") + 1.25, "send");
    cue(S("knowledge") + 2.1, "pop", { note: 5 });
    cue(S("knowledge") + 2.4, "tick", { note: 4 });
    // Ask: a message, a question, an answer.
    cue(S("ask") + 0.3, "send");
    cue(S("ask") + 0.65, "pop", { note: 3 });
    cue(S("ask") + 1.95, "pop", { note: 6 });
    // Until done: each round, each check.
    ROUNDS.forEach(([come, , judged], i) => {
      cue(S("until") + come, "pop", { note: 2 + i * 2 });
      cue(S("until") + judged, i < 2 ? "nope" : "chime");
    });
    // Guardrails: allowed, then the rails.
    cue(S("guard") + 1.3, "chime");
    for (let i = 0; i < 4; i++) cue(S("guard") + 1.75 + i * 0.125, "pop", { note: i, soft: true });
    // Training: the steps, ready, a new model.
    for (let i = 0; i < 3; i++) cue(S("train") + 0.2 + i * 0.15, "pop", { note: 2 + i * 2 });
    cue(S("train") + 2.05, "chime");
    cue(S("train") + 2.7, "pop", { note: 7 });
    // Share: the code, the phone, the messages.
    cue(S("share") + 0.45, "pop", { note: 4 });
    cue(S("share") + 0.75, "whoosh", { dir: -1, small: true });
    cue(S("share") + 1.4, "send");
    cue(S("share") + 2.0, "pop", { note: 6 });
    cue(S("share") + 2.6, "send");
    // Montage: the wall, then a hit on every word.
    for (let i = 0; i < 24; i++) cue(S("montage") + 0.3 + i * 0.05, "pop", { note: i % 15, soft: true });
    FEAT.forEach((f) => cue(S("montage") + f, "stab"));
    cues.sort((a, b) => a.t - b.t);
  }

  /* ---------- the drops: a shake, and a flash on the first and the last ---------- */
  function camera(T) {
    let dx = 0;
    let dy = 0;
    for (const d of DROPS) {
      const t = T - d;
      if (t < 0 || t > 0.5) continue;
      const a = (d === 40 ? 9 : 16) * Math.exp(-t / 0.11);
      dx += a * Math.sin(t * 97);
      dy += a * Math.cos(t * 71);
    }
    $("#cam").style.transform = dx || dy ? `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px)` : "none";
    const first = T >= 4 ? 0.9 * (1 - outCubic(prog(T, 4, 0.22))) : 0;
    const last = T >= 54 ? 0.45 * (1 - outCubic(prog(T, 54, 0.3))) : 0;
    $("#flash").style.opacity = r3(Math.max(first, last));
  }

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
      const on = T >= sc.a && T < sc.b + TAIL;
      sc.el.style.visibility = on ? "visible" : "hidden";
      if (!on) continue;
      frame(sc, t);
      draw[id](t, sc.el);
    }
    $("#stage").style.opacity = r3(1 - prog(T, DURATION - 0.6, 0.6));
    camera(T);
    pointer(T);
    animationsAt(T);
  }

  let ready = false;
  function setup() {
    if (ready) return;
    ready = true;
    measureWires();
    const chip = $("#mchip").getBoundingClientRect();
    const menu = $("#mod-menu");
    menu.style.left = `${chip.right - menu.offsetWidth}px`;
    menu.style.top = `${chip.bottom + 12}px`;
    menu.style.transformOrigin = "top right";
    for (const id of ["#kept", "#guards"]) {
      const el = $(id);
      el.style.left = `${(1920 - el.offsetWidth) / 2}px`;
    }
    pointerPlan();
    scoreCues();
  }

  window.VIDEO = {
    duration: DURATION,
    setup,
    render(T) { setup(); render(T); },
    /** What the soundtrack follows: the beat, where the builds, drops and break fall, and every sound. */
    score() {
      setup();
      return {
        bpm: 120,
        duration: DURATION,
        drops: DROPS,
        builds: [[0, 4], [38, 40], [52, 54]],
        breaks: [[36, 40]],
        hush: [[3.875, 4], [39.875, 40], [53.875, 54]],
        outro: [58, DURATION],
        cues,
      };
    },
  };

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
