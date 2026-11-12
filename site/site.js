/* McBot website: the burger's eyes in the hero, the crew graph, and the parade on
   the closing card. The bots come from foods.js, the same code the app draws them with.
   Reduced motion: no idling and no pulses; eyes still follow the cursor. */
(() => {
  window.McBotSite = true;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const F = window.McBotFoods;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (xs) => xs[Math.floor(Math.random() * xs.length)];

  // The cursor. Touch has none, so the bots idle there.
  const pointer = { x: 0, y: 0, at: -1e9 };
  addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch") return;
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.at = performance.now();
  }, { passive: true });
  const live = () => performance.now() - pointer.at < 5000;

  // Nav turns more solid once the page scrolls.
  const nav = document.querySelector("[data-nav]");
  const onScroll = () => { if (nav) nav.classList.toggle("scrolled", scrollY > 24); };
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /** Runs `tick` every frame while `el` is on screen. */
  function whileVisible(el, tick) {
    let raf = 0;
    const loop = (t) => { tick(t); raf = requestAnimationFrame(loop); };
    new IntersectionObserver(([e]) => {
      cancelAnimationFrame(raf);
      if (e.isIntersecting) raf = requestAnimationFrame(loop);
    }).observe(el);
  }

  /* ---------- the glass burger ---------- */
  const bot = document.querySelector("[data-bot]");
  if (bot) {
    const s = { ex: 0, ey: 0, blinkAt: 1.6, blinkStart: -9, last: performance.now() };
    const set = (k, v) => bot.style.setProperty(k, v);
    whileVisible(bot, (now) => {
      const dt = Math.min(0.05, (now - s.last) / 1000);
      s.last = now;
      const t = now / 1000;
      const r = bot.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height * 0.45;
      let dx, dy, px, py;
      if (live()) {
        px = pointer.x;
        py = pointer.y;
        dx = clamp((px - cx) / (innerWidth * 0.45), -1, 1);
        dy = clamp((py - cy) / (innerHeight * 0.45), -1, 1);
      } else {
        const k = reduce ? 0 : t;
        dx = Math.sin(k * 0.45) * 0.6;
        dy = Math.sin(k * 0.31 + 1) * 0.35;
        px = cx + dx * 300;
        py = r.top + r.height * 0.28 + dy * 200;
      }
      const e = 1 - Math.pow(0.002, dt);
      // the pupils look at the cursor
      const vx = px - cx, vy = py - (r.top + r.height * 0.28);
      const len = Math.hypot(vx, vy) || 1;
      const reach = Math.min(1, len / 180) / len;
      s.ex = lerp(s.ex, vx * reach, Math.min(1, e * 1.6));
      s.ey = lerp(s.ey, vy * reach, Math.min(1, e * 1.6));
      // blink now and then, sometimes twice
      if (!reduce && t > s.blinkAt) {
        s.blinkStart = t;
        s.blinkAt = t + (Math.random() < 0.25 ? 0.32 : rand(2.4, 5.5));
      }
      const bp = (t - s.blinkStart) / 0.17;
      const blink = bp >= 0 && bp <= 1 ? 1 - Math.sin(bp * Math.PI) * 0.92 : 1;

      set("--ex", s.ex.toFixed(3));
      set("--ey", s.ey.toFixed(3));
      set("--blink", blink.toFixed(3));
    });

    // Click it and it smiles.
    let happyTimer = 0;
    const poke = () => {
      bot.classList.add("happy");
      clearTimeout(happyTimer);
      happyTimer = setTimeout(() => bot.classList.remove("happy"), 1300);
    };
    bot.addEventListener("pointerdown", poke);
    bot.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); poke(); } });
  }

  if (!F) return;

  /* ---------- bots that look at things ---------- */
  const EYES = Object.fromEntries(F.FOODS.map((f) => [f.id, f.eyes]));
  /** Turn a bot's eyes toward a point on screen (or forward when there is none). */
  function look(svg, target) {
    const g = svg && svg.querySelector(".eyes");
    if (!g) return;
    const exp = svg.dataset.exp;
    if (exp === "thinking") return;
    const [ex, ey] = EYES[svg.dataset.food] || [32, 32];
    let lx = 0, ly = 0;
    if (target) {
      const r = svg.getBoundingClientRect();
      const vx = target[0] - (r.left + (r.width * ex) / 64);
      const vy = target[1] - (r.top + (r.height * ey) / 64);
      const len = Math.hypot(vx, vy) || 1;
      const k = Math.min(1, len / 160) / len;
      lx = vx * k;
      ly = vy * k;
    }
    const prev = svg._look || [0, 0];
    const now = [lerp(prev[0], lx, 0.2), lerp(prev[1], ly, 0.2)];
    svg._look = now;
    g.setAttribute("transform", `translate(${(ex + now[0] * 2.2).toFixed(2)} ${(ey + now[1] * 1.6 + (exp === "sad" ? 1 : 0)).toFixed(2)})`);
  }

  /* ---------- the crew: ten agents and the models and tools they use ----------
     As on McBot's canvas: each agent works on its own, and while it runs, the wire
     to its model (then to a tool) lights up. Agents handing work to each other
     comes with the Tasks milestone (M7), so the graph does not show it yet. */
  const crew = document.querySelector("[data-crew]");
  if (crew) {
    // name, x%, y% (wide), x%, y% (narrow), its model, its tool (or null). The name picks the bot, as in the app.
    const CREW = [
      ["Triage", 10, 18, 16, 10, 0, 3], ["Researcher", 30, 18, 16, 30, 1, 2], ["Writer", 50, 18, 16, 50, 1, null],
      ["Designer", 70, 18, 16, 70, 1, 3], ["Finance", 90, 18, 16, 90, 0, 3], ["Coder", 10, 84, 84, 10, 0, 3],
      ["Archivist", 30, 84, 84, 30, 0, 2], ["Sage", 50, 84, 84, 50, 1, 2], ["Tester", 70, 84, 84, 70, 0, 3], ["Muse", 90, 84, 84, 90, 1, null],
    ];
    // kind, label, x%, y% (wide), x%, y% (narrow), glyph
    const PARTS = [
      ["model", "Local model", 20, 51, 50, 20, '<rect x="5" y="6" width="14" height="12" rx="2.5"/><path d="M9 10.5h6M9 13.5h6"/>'],
      ["cloud", "Cloud model", 40, 51, 50, 40, '<path d="M7.5 18h9.5a4 4 0 0 0 .4-8A5.5 5.5 0 0 0 6.9 11.6 3.3 3.3 0 0 0 7.5 18Z"/>'],
      ["tool", "Docs search", 60, 51, 50, 60, '<circle cx="11" cy="11" r="5"/><path d="m15 15 4 4"/>'],
      ["tool", "Shared files", 80, 51, 50, 80, '<path d="M4 7.5A1.5 1.5 0 0 1 5.5 6H10l2 2h6.5A1.5 1.5 0 0 1 20 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5Z"/>'],
    ];
    const wires = crew.querySelector("svg.wires");
    const parts = PARTS.map(([kind, label, , , , , glyph]) => {
      const el = document.createElement("div");
      el.className = "crew-part";
      el.innerHTML = `<span class="tile ${kind}"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${glyph}</svg></span><b>${label}</b>`;
      crew.appendChild(el);
      return { el, busy: 0 };
    });
    const bots = CREW.map(([name, , , , , model, tool], i) => {
      const el = document.createElement("div");
      el.className = "crew-bot";
      el.dataset.state = "idle";
      el.innerHTML = `<span class="face"></span><b>${name}</b>`;
      crew.appendChild(el);
      return { el, face: el.firstChild, name, exp: "", busy: 0, tone: F.foodOf(`agent:${name.toLowerCase()}`).tone, model, tool, i };
    });
    let size = 64;
    function draw(b, exp) {
      b.exp = exp;
      b.el.dataset.state = exp;
      b.face.innerHTML = F.foodSvg({ seed: `agent:${b.name.toLowerCase()}`, size, expression: exp, uid: `crew${b.i}`, title: b.name });
    }
    // one wire per agent → part, keyed "agent:part"
    let paths = {};
    function layout() {
      const narrow = crew.clientWidth < 640;
      size = narrow ? 48 : 60;
      const W = crew.clientWidth, H = crew.clientHeight;
      const pos = (x, y, nx, ny) => [((narrow ? nx : x) / 100) * W, ((narrow ? ny : y) / 100) * H];
      const at = CREW.map(([, x, y, nx, ny]) => pos(x, y, nx, ny));
      const pat = PARTS.map(([, , x, y, nx, ny]) => pos(x, y, nx, ny));
      bots.forEach((b, i) => { b.el.style.left = `${at[i][0]}px`; b.el.style.top = `${at[i][1]}px`; draw(b, b.exp || "idle"); });
      parts.forEach((p, i) => { p.el.style.left = `${pat[i][0]}px`; p.el.style.top = `${pat[i][1]}px`; });
      // wires meet at the faces and tiles, above their name tags
      const botLift = -15, partLift = -12;
      wires.setAttribute("viewBox", `0 0 ${W} ${H}`);
      const out = [];
      bots.forEach((b, i) => {
        for (const k of [b.model, b.tool]) {
          if (k === null) continue;
          const [ax, ay] = [at[i][0], at[i][1] + botLift], [bx, by] = [pat[k][0], pat[k][1] + partLift];
          const dx = bx - ax, dy = by - ay;
          const c = narrow ? `C${ax + dx * 0.5} ${ay} ${bx - dx * 0.5} ${by}` : `C${ax} ${ay + dy * 0.5} ${bx} ${by - dy * 0.5}`;
          out.push(`<path data-k="${i}:${k}" d="M${ax} ${ay} ${c} ${bx} ${by}"/>`);
        }
      });
      wires.innerHTML = out.join("");
      paths = Object.fromEntries([...wires.querySelectorAll("path")].map((p) => [p.dataset.k, p]));
    }
    new ResizeObserver(layout).observe(crew);
    layout();

    /** Light the wire from an agent to a model or tool, the way a live edge does in the app. */
    function pulse(b, k) {
      const base = paths[`${b.i}:${k}`];
      if (!base || reduce) return 700;
      const p = base.cloneNode();
      p.setAttribute("class", "pulse");
      p.style.color = `var(--food-${b.tone})`;
      const len = base.getTotalLength();
      const seg = 46;
      p.style.strokeDasharray = `${seg} ${len + seg}`;
      wires.appendChild(p);
      const dur = clamp(len * 2.6, 650, 1400);
      p.animate([{ strokeDashoffset: seg }, { strokeDashoffset: -len }], { duration: dur, easing: "cubic-bezier(.45,0,.25,1)" }).onfinish = () => p.remove();
      parts[k].el.classList.add("live");
      parts[k].busy = performance.now() + dur;
      setTimeout(() => { if (parts[k].busy <= performance.now() + 20) parts[k].el.classList.remove("live"); }, dur);
      return dur;
    }

    let visible = false;
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(crew);
    function work() {
      if (!visible || document.hidden || reduce) return;
      const now = performance.now();
      const free = bots.filter((b) => b.busy < now);
      if (!free.length) return;
      const b = pick(free);
      b.busy = now + 6000;
      draw(b, "thinking");
      setTimeout(() => {
        const d1 = pulse(b, b.model);
        const d2 = b.tool === null ? 0 : (setTimeout(() => pulse(b, b.tool), d1 + 250), d1 + 250 + 900);
        const done = Math.max(d1, d2) + 500;
        setTimeout(() => draw(b, Math.random() < 0.12 ? "sad" : "happy"), done);
        setTimeout(() => draw(b, "idle"), done + 1900);
      }, 500);
    }
    setInterval(work, 900);

    for (const b of bots) {
      b.el.addEventListener("pointerenter", () => {
        if (b.busy > performance.now()) return;
        draw(b, "happy");
        b.busy = performance.now() + 1400;
        setTimeout(() => { if (b.exp === "happy") draw(b, "idle"); }, 1400);
      });
    }

    // Idle bots look at the cursor, or at whoever is working.
    whileVisible(crew, () => {
      let target = live() ? [pointer.x, pointer.y] : null;
      if (!target) {
        const w = bots.find((b) => b.exp === "thinking");
        if (w) { const r = w.face.getBoundingClientRect(); target = [r.left + r.width / 2, r.top + r.height / 2]; }
      }
      for (const b of bots) look(b.face.firstChild, b.exp === "thinking" ? null : target);
    });
  }

  /* ---------- the parade on the closing card ---------- */
  const parade = document.querySelector("[data-parade]");
  if (parade) {
    const CAST = [["fries", 6], ["cup", 2], ["cone", 9], ["burger", 8], ["pizza", 7], ["donut", 3], ["onigiri", 4], ["cookie", 1]];
    const small = matchMedia("(max-width: 560px)").matches;
    const members = CAST.map(([food, tone], i) => {
      const el = document.createElement("span");
      el.style.setProperty("--delay", `${(-i * 0.37).toFixed(2)}s`);
      const render = (exp) => { el.innerHTML = F.foodSvg({ seed: food, food, tone, size: small ? 46 : 60, expression: exp, uid: `parade${i}`, title: "" }); };
      render("idle");
      let timer = 0;
      el.addEventListener("pointerenter", () => { render("happy"); clearTimeout(timer); timer = setTimeout(() => render("idle"), 1200); });
      parade.appendChild(el);
      return el;
    });
    whileVisible(parade, () => {
      const target = live() ? [pointer.x, pointer.y] : null;
      for (const el of members) look(el.firstChild, target);
    });
  }
})();

// Copy the install command.
for (const b of document.querySelectorAll("[data-copy]")) {
  b.addEventListener("click", async () => {
    const text = b.parentElement?.querySelector("code")?.textContent ?? "";
    try {
      await navigator.clipboard.writeText(text);
      b.textContent = "Copied";
      setTimeout(() => (b.textContent = "Copy"), 1500);
    } catch {
      /* select it by hand */
    }
  });
}
