/*
 * McBot Studio's website: the burger's eyes, the bots (foods.js, the same code the app draws them
 * with), the moving brand rows, and the small live views: the app's chat, the model switch, the
 * harness compiling, an approval, ⌘K. Each one plays only while it is on screen; with reduced
 * motion each one shows its final state. Downloads come from the latest GitHub release.
 */
document.documentElement.classList.add("js");

(() => {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const F = window.McBotFoods;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let uid = 0;
  // The app seeds an agent's bot with "agent:<name>", so the same name is the same bot here.
  const face = (name, size, expression = "idle") => (F ? F.foodSvg({ seed: `agent:${name}`, size, expression, uid: `f${uid++}`, title: "" }) : "");

  /* ---------- the bots, and brand tiles wherever a slot names one ---------- */
  $$("[data-agent]").forEach((el) => { el.innerHTML = face(el.dataset.agent, Number(el.dataset.size || 32)); });
  const logo = (key) => $(`.mq li[data-key="${key}"] .lg`)?.cloneNode(true) ?? null;
  $$("[data-logo]").forEach((el) => { const l = logo(el.dataset.logo); if (l) el.replaceChildren(l); });

  /* ---------- brand rows: repeated until a set is wider than the screen, then that set twice, so
     the -50% loop never shows a seam; every row moves at the same pace, whatever its length ---------- */
  const echo = (ul, items) => { for (const li of items) { const c = li.cloneNode(true); c.setAttribute("aria-hidden", "true"); ul.appendChild(c); } };
  $$("[data-marquee] .mq").forEach((ul, row) => {
    const base = [...ul.children];
    if (!base.length) return;
    while (ul.scrollWidth < Math.max(innerWidth, 1200) * 1.1) echo(ul, base);
    echo(ul, [...ul.children]);
    const pace = row === 1 ? 26 : 32; // px a second
    ul.style.animationDuration = `${Math.round(ul.scrollWidth / 2 / pace)}s`;
  });

  /* ---------- coming into view ---------- */
  const seen = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); seen.unobserve(e.target); }
  }, { threshold: 0.18, rootMargin: "0px 0px -6% 0px" });
  $$("[data-in]").forEach((el) => seen.observe(el));
  // The hero is on screen at once: it arrives with the page.
  requestAnimationFrame(() => $$(".hero [data-in]").forEach((el) => el.classList.add("in")));

  /* ---------- nav ---------- */
  const nav = $("[data-nav]");
  const onScroll = () => nav?.classList.toggle("scrolled", scrollY > 24);
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---------- the cursor (touch has none, so the bots idle there) ---------- */
  const pointer = { x: 0, y: 0, at: -1e9 };
  addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch") return;
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.at = performance.now();
  }, { passive: true });
  const live = () => performance.now() - pointer.at < 5000;

  /** Runs `tick` every frame while `el` is on screen. */
  function everyFrame(el, tick) {
    let raf = 0;
    const loop = (t) => { tick(t); raf = requestAnimationFrame(loop); };
    new IntersectionObserver(([e]) => {
      cancelAnimationFrame(raf);
      if (e.isIntersecting) raf = requestAnimationFrame(loop);
    }).observe(el);
  }

  /**
   * A small scene that plays, and loops, only while `el` is on screen: `sleep` waits, and holds
   * while the scene is scrolled away. Reduced motion: `still` draws the final state once.
   */
  function scene(el, play, still) {
    if (!el) return;
    if (reduce) { still?.(); return; }
    let visible = false;
    let running = false;
    const sleep = async (ms) => {
      await wait(ms);
      while (!visible) await wait(200);
    };
    new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible && !running) {
        running = true;
        (async () => { for (;;) await play(sleep); })();
      }
    }, { threshold: 0.3 }).observe(el);
  }

  /* ---------- the glass burger: eyes follow the cursor, it blinks, a poke makes it happy ---------- */
  const bot = $("[data-bot]");
  if (bot) {
    const s = { ex: 0, ey: 0, blinkAt: 1.4, blinkStart: -9, last: performance.now() };
    const set = (k, v) => bot.style.setProperty(k, v);
    everyFrame(bot, (now) => {
      const dt = Math.min(0.05, (now - s.last) / 1000);
      s.last = now;
      const t = now / 1000;
      const r = bot.getBoundingClientRect();
      let dx;
      let dy;
      if (live()) {
        dx = clamp((pointer.x - (r.left + r.width / 2)) / (innerWidth * 0.45), -1, 1);
        dy = clamp((pointer.y - (r.top + r.height * 0.45)) / (innerHeight * 0.45), -1, 1);
      } else {
        const k = reduce ? 0 : t;
        dx = Math.sin(k * 0.45) * 0.6;
        dy = Math.sin(k * 0.31 + 1) * 0.35;
      }
      const ease = 1 - Math.exp(-dt * 10);
      s.ex += (dx - s.ex) * ease;
      s.ey += (dy - s.ey) * ease;
      set("--ex", s.ex.toFixed(3));
      set("--ey", s.ey.toFixed(3));
      if (!reduce && t > s.blinkAt) { s.blinkStart = t; s.blinkAt = t + 2.4 + Math.random() * 3; }
      const b = (t - s.blinkStart) / 0.16;
      set("--blink", b >= 0 && b < 1 ? (Math.abs(b - 0.5) * 2).toFixed(2) : "1");
      const tilt = bot.querySelector(".bot-tilt");
      if (tilt && !reduce) tilt.style.transform = `translateY(${(Math.sin(t * 1.3) * 4).toFixed(2)}px) rotate(${(s.ex * 3).toFixed(2)}deg)`;
    });
    let timer = 0;
    const poke = () => {
      bot.classList.add("happy");
      clearTimeout(timer);
      timer = setTimeout(() => bot.classList.remove("happy"), 1200);
    };
    bot.addEventListener("pointerdown", poke);
    bot.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); poke(); } });
  }

  /* ---------- the app's chat: asks, uses a tool, answers, asks before acting ---------- */
  const hero = $("[data-hero]");
  scene(hero, async (sleep) => {
    const thread = $("[data-thread]", hero);
    const input = $("[data-input]", hero);
    const send = $(".w-send", hero);
    const notch = $("[data-notch]", hero);
    const preview = $("[data-preview]", hero);
    const setNotch = (html, cls = "") => { notch.className = `notch ${cls}`; notch.innerHTML = `<span class="nt">${html}</span>`; };
    const add = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); const el = t.content.firstElementChild; thread.appendChild(el); return el; };
    thread.classList.remove("fade");
    thread.textContent = "";
    setNotch("Ready");
    preview.textContent = "Finds answers in your docs";
    await sleep(500);

    const q = "Which tickets need me today?";
    input.classList.add("typed");
    input.textContent = "";
    for (const ch of q) { input.textContent += ch; await sleep(26); }
    send.classList.add("on");
    await sleep(240);
    input.classList.remove("typed");
    input.textContent = "Message Researcher";
    send.classList.remove("on");
    add(`<div class="m-me">${q}</div>`);

    let secs = 0;
    setNotch(`Researcher <span class="tm">0:00</span>`, "work");
    const clock = setInterval(() => { secs++; const tm = $(".tm", notch); if (tm) tm.textContent = `0:0${Math.min(9, secs)}`; }, 1000);
    preview.textContent = "Working…";
    await sleep(350);
    const ai = add(`<div class="m-ai"><div class="who">${face("researcher", 18, "thinking")}Researcher</div><div class="m-tool"><i></i>Tickets: search</div></div>`);
    await sleep(900);
    $(".m-tool", ai).classList.add("done");
    const p = document.createElement("p");
    ai.appendChild(p);
    for (const w of "Three need you today:".split(" ")) { p.textContent += (p.textContent ? " " : "") + w; await sleep(45); }
    const ol = document.createElement("ol");
    ai.appendChild(ol);
    for (const line of ["A refund over $200, waiting on your OK", "A login loop on Safari, marked urgent", "A data export request, due Friday"]) {
      const li = document.createElement("li");
      ol.appendChild(li);
      for (const w of line.split(" ")) { li.textContent += (li.textContent ? " " : "") + w; await sleep(32); }
    }
    await sleep(450);
    const ask = add(`<div class="m-ask"><div class="h">Researcher asks before acting</div><code>gh issue create --title "Login loop on Safari"</code><div class="row"><span class="b a">Allow once</span><span class="b">Deny</span></div></div>`);
    clearInterval(clock);
    setNotch("Asks you: open an issue", "ask");
    preview.textContent = "Asks before acting";
    await sleep(1400);
    $(".b.a", ask).classList.add("press");
    await sleep(170);
    ask.classList.add("done");
    $(".h", ask).textContent = "Allowed once";
    $(".row", ask).remove();
    await sleep(500);
    add(`<div class="m-ai"><p>Done: issue #482 is open and linked to the ticket.</p></div>`);
    setNotch("Done · issue #482", "ok");
    preview.textContent = "Done: issue #482 is open";
    await sleep(3400);
    thread.classList.add("fade");
    await sleep(380);
  }, () => {
    const thread = $("[data-thread]", hero);
    thread.innerHTML = `<div class="m-me">Which tickets need me today?</div><div class="m-ai"><div class="who">${face("researcher", 18, "happy")}Researcher</div><div class="m-tool done"><i></i>Tickets: search</div><p>Three need you today:</p><ol><li>A refund over $200, waiting on your OK</li><li>A login loop on Safari, marked urgent</li><li>A data export request, due Friday</li></ol></div>`;
  });

  /* ---------- switch models, not apps ---------- */
  const sw = $("[data-switcher]");
  if (sw) {
    const MODELS = [
      { key: "claude", name: "Claude", where: "Anthropic · cloud" },
      { key: "gemini", name: "Gemini", where: "Google · cloud" },
      { key: "meta", name: "Llama 3.3", where: "On this computer · Ollama" },
      { key: "qwen", name: "Qwen3", where: "On this computer · LM Studio" },
      { key: "deepseek", name: "DeepSeek", where: "DeepSeek · cloud" },
      { key: "mistral", name: "Mistral", where: "Mistral · cloud" },
    ].filter((m) => logo(m.key));
    const box = $(".sw-model", sw);
    const list = $("[data-sw-list]", sw);
    const keeps = $(".sw-keeps", sw);
    let at = 0;
    const show = (i, animate) => {
      at = i;
      const m = MODELS[i];
      $("[data-sw-logo]", sw).replaceChildren(logo(m.key));
      $("[data-sw-name]", sw).textContent = m.name;
      $("[data-sw-where]", sw).textContent = m.where;
      $$("span", list).forEach((s, n) => s.classList.toggle("on", n === i));
      if (animate) {
        box.classList.remove("swap");
        keeps.classList.remove("flash");
        void box.offsetWidth;
        box.classList.add("swap");
        keeps.classList.add("flash");
      }
    };
    MODELS.forEach((m, i) => {
      const s = document.createElement("span");
      s.appendChild(logo(m.key));
      s.title = m.name;
      s.addEventListener("click", () => show(i, true));
      list.appendChild(s);
    });
    show(0, false);
    scene(sw, async (sleep) => {
      await sleep(1900);
      show((at + 1) % MODELS.length, true);
    });
  }

  /* ---------- the harness: blocks arrive, wires draw, Compile writes the files ---------- */
  const board = $("[data-board]");
  if (board) {
    const stage = $("[data-stage]", board);
    const svg = $("[data-wires]", board);
    const files = $("[data-files]", board);
    const compile = $("[data-compile]", board);
    const node = (n) => $(`[data-n="${n}"]`, stage);
    const WIRES = [["m1", "a", "thinks with"], ["m2", "a", "falls back to"], ["a", "t1", "uses"], ["a", "t2", "uses"], ["a", "t3", "answers on"]];
    const labels = WIRES.map(([, , text]) => { const l = document.createElement("span"); l.className = "wl"; l.textContent = text; stage.appendChild(l); return l; });
    let paths = [];
    const layout = () => {
      const box = stage.getBoundingClientRect();
      svg.setAttribute("viewBox", `0 0 ${box.width} ${box.height}`);
      const rect = (el) => { const r = el.getBoundingClientRect(); return { x: r.left - box.left, y: r.top - box.top, w: r.width, h: r.height }; };
      svg.innerHTML = WIRES.map(([a, b], i) => {
        const A = node(a);
        const B = node(b);
        if (!A || !B || getComputedStyle(B).display === "none" || getComputedStyle(A).display === "none") return `<path data-i="${i}" d=""/>`;
        const ra = rect(A);
        const rb = rect(B);
        const side = rb.x > ra.x + ra.w * 0.5;
        let x1, y1, x2, y2, d;
        if (side) {
          x1 = ra.x + ra.w; y1 = ra.y + ra.h / 2; x2 = rb.x; y2 = rb.y + rb.h / 2;
          const c = Math.max(30, (x2 - x1) / 2);
          d = `M${x1} ${y1} C${x1 + c} ${y1} ${x2 - c} ${y2} ${x2} ${y2}`;
        } else {
          // Stacked (narrow screens): bottom of one into the top of the other.
          const down = rb.y > ra.y;
          x1 = ra.x + ra.w / 2; y1 = down ? ra.y + ra.h : ra.y; x2 = rb.x + rb.w / 2; y2 = down ? rb.y : rb.y + rb.h;
          const c = Math.max(24, Math.abs(y2 - y1) / 2);
          d = `M${x1} ${y1} C${x1} ${y1 + (down ? c : -c)} ${x2} ${y2 - (down ? c : -c)} ${x2} ${y2}`;
        }
        labels[i].style.left = `${(x1 + x2) / 2}px`;
        labels[i].style.top = `${(y1 + y2) / 2}px`;
        return `<path data-i="${i}" d="${d}"/>`;
      }).join("");
      paths = $$("path", svg);
      for (const p of paths) {
        const len = p.getTotalLength ? Math.ceil(p.getTotalLength()) : 400;
        p.style.strokeDasharray = `${len}`;
        p.style.strokeDashoffset = p.dataset.on ? "0" : `${len}`;
      }
    };
    const wire = (i, on) => {
      const p = paths[i];
      if (!p) return;
      p.dataset.on = on ? "1" : "";
      p.style.strokeDashoffset = on ? "0" : p.style.strokeDasharray;
      labels[i].classList.toggle("on", on && !!p.getAttribute("d"));
    };
    addEventListener("resize", () => { layout(); paths.forEach((p, i) => wire(i, !!p.dataset.on)); });
    const order = ["a", "m1", "m2", "t1", "t2", "t3"];
    const reset = () => {
      $$(".bn", stage).forEach((n) => n.classList.remove("on", "hot"));
      files.classList.remove("on");
      layout();
      WIRES.forEach((_, i) => wire(i, false));
    };
    scene(board, async (sleep) => {
      reset();
      await sleep(300);
      for (const n of order) { node(n).classList.add("on"); await sleep(170); }
      await sleep(250);
      layout();
      for (let i = 0; i < WIRES.length; i++) { wire(i, true); await sleep(260); }
      await sleep(500);
      node("a").classList.add("hot");
      paths.forEach((p) => p.classList.add("hot"));
      await sleep(600);
      compile.classList.add("press");
      await sleep(160);
      compile.classList.remove("press");
      files.classList.add("on");
      await sleep(3600);
      paths.forEach((p) => p.classList.remove("hot"));
      files.classList.remove("on");
      await sleep(500);
    }, () => {
      $$(".bn", stage).forEach((n) => n.classList.add("on"));
      layout();
      WIRES.forEach((_, i) => wire(i, true));
    });
  }

  /* ---------- asks before it acts ---------- */
  const approve = $("[data-approve]");
  scene(approve, async (sleep) => {
    approve.classList.remove("done");
    await sleep(1800);
    const allow = $("[data-allow]", approve);
    allow.classList.add("press");
    await sleep(170);
    allow.classList.remove("press");
    approve.classList.add("done");
    await sleep(2600);
  }, () => approve.classList.add("done"));

  /* ---------- ⌘K ---------- */
  const palette = $("[data-palette]");
  scene(palette, async (sleep) => {
    const q = $("[data-pl-q]", palette);
    const rows = $$(".pl-row", palette);
    for (const word of ["ask res", "ask wri", "new"]) {
      q.textContent = "";
      for (const ch of word) { q.textContent += ch; await sleep(70); }
      const pick = word.startsWith("ask r") ? 0 : word.startsWith("ask w") ? 1 : 2;
      rows.forEach((r, i) => r.classList.toggle("on", i === pick));
      await sleep(1300);
    }
  }, () => { $("[data-pl-q]", palette).textContent = "ask res"; });

  /* ---------- the terminal: the same setup, without McBot ---------- */
  const term = $("[data-term]");
  scene(term, async (sleep) => {
    const out = $("[data-typed]", term);
    for (const line of ["What did we decide about refunds?", "Summarise this week's tickets"]) {
      out.textContent = "";
      for (const ch of line) { out.textContent += ch; await sleep(34); }
      await sleep(1600);
    }
  }, () => { $("[data-typed]", term).textContent = "What did we decide about refunds?"; });

  /* ---------- skills: count up once ---------- */
  const count = $("[data-count]");
  if (count && !reduce) {
    const to = Number(count.dataset.count);
    new IntersectionObserver(([e], o) => {
      if (!e.isIntersecting) return;
      o.disconnect();
      const t0 = performance.now();
      const step = (t) => {
        const k = Math.min(1, (t - t0) / 900);
        count.textContent = String(Math.round(to * (1 - (1 - k) ** 3)));
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }, { threshold: 0.5 }).observe(count);
  }

  /* ---------- the crew at the end: they bob, look at the cursor, and smile when touched ---------- */
  const parade = $("[data-parade]");
  if (parade && F) {
    const CAST = [["fries", 6], ["cup", 2], ["cone", 9], ["burger", 8], ["pizza", 7], ["donut", 3], ["onigiri", 4], ["cookie", 1]];
    const size = matchMedia("(max-width: 560px)").matches ? 40 : 56;
    CAST.forEach(([food, tone], i) => {
      const el = document.createElement("span");
      el.style.setProperty("--delay", `${(-i * 0.3).toFixed(2)}s`);
      const render = (exp) => { el.innerHTML = F.foodSvg({ seed: food, food, tone, size, expression: exp, uid: `parade${i}`, title: "" }); };
      render("idle");
      let timer = 0;
      el.addEventListener("pointerenter", () => { render("happy"); clearTimeout(timer); timer = setTimeout(() => render("idle"), 1100); });
      parade.appendChild(el);
    });
  }

  /* ---------- the split download button ---------- */
  const split = $("[data-split]");
  if (split) {
    const more = $(".split-more", split);
    const menu = $(".split-menu", split);
    const set = (open) => { menu.hidden = !open; more.setAttribute("aria-expanded", String(open)); };
    more.addEventListener("click", (e) => { e.stopPropagation(); set(menu.hidden); });
    document.addEventListener("click", (e) => { if (!split.contains(e.target)) set(false); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") set(false); });
    $$("a", menu).forEach((a) => a.addEventListener("click", () => set(false)));
  }

  /* ---------- copy the install command ---------- */
  $$("[data-copy]").forEach((b) => b.addEventListener("click", async () => {
    const text = b.parentElement?.querySelector("code")?.textContent ?? "";
    try {
      await navigator.clipboard.writeText(text);
      b.textContent = "Copied";
      setTimeout(() => { b.textContent = "Copy"; }, 1500);
    } catch {
      /* select it by hand */
    }
  }));

  /* ---------- downloads: the newest release's installers, your computer first ---------- */
  const REPO = "CasperCrypto/mcbot";
  const ua = navigator.userAgent;
  const platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "";
  const mobile = /iPhone|iPad|iPod|Android/i.test(ua) || (/Mac/.test(platform) && navigator.maxTouchPoints > 1);
  const os = mobile ? "mobile" : /Win/i.test(platform) ? "windows" : /Mac/i.test(platform) ? "mac" : /Linux/i.test(platform) ? "linux" : "mac";
  const NAMES = { mac: "macOS", windows: "Windows", linux: "Linux" };
  // Tauri's default bundle names.
  const KINDS = {
    mac: [[/_aarch64\.dmg$/i, "Apple silicon", ".dmg"], [/_x64\.dmg$/i, "Intel", ".dmg"], [/_universal\.dmg$/i, "Universal", ".dmg"]],
    windows: [[/_x64-setup\.exe$/i, "Installer", ".exe"], [/_x64_[a-z-]+\.msi$/i, "Installer", ".msi"]],
    linux: [[/\.AppImage$/i, "AppImage", "x86_64"], [/_amd64\.deb$/i, "Debian, Ubuntu", ".deb"]],
  };
  const card = (k) => $(`.os[data-os="${k}"]`);
  card(os)?.classList.add("current");
  const render = (release) => {
    const assets = release ? release.assets || [] : [];
    const found = {};
    for (const k of Object.keys(KINDS)) {
      const box = card(k)?.querySelector("[data-links]");
      if (!box) continue;
      box.textContent = "";
      found[k] = [];
      for (const [re, label, kind] of KINDS[k]) {
        const a = assets.find((x) => re.test(x.name));
        if (!a) continue;
        found[k].push(a.browser_download_url);
        const b = document.createElement("a");
        b.className = `btn${k === os && found[k].length === 1 ? " primary" : ""}`;
        b.href = a.browser_download_url;
        b.innerHTML = `${label} <span>${kind}</span>`;
        box.appendChild(b);
      }
      if (!found[k].length) { const s = document.createElement("span"); s.className = "soon"; s.textContent = "Coming soon"; box.appendChild(s); }
    }
    const label = $("[data-dl-label]");
    const primary = $("[data-dl-primary]");
    if (label) label.textContent = os === "mobile" ? "Download for desktop" : `Download for ${NAMES[os]}`;
    if (primary && os !== "mobile" && found[os] && found[os].length) primary.href = found[os][0];
  };
  render(null);
  fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: "application/vnd.github+json" } })
    .then((r) => (r.ok ? r.json() : null))
    .then((rel) => { if (rel && rel.assets) render(rel); })
    .catch(() => { /* offline or blocked: the cards keep "Coming soon" */ });
})();
