/* McBot website motion: the glass burger in the hero, the crew graph, the parade
   on the closing card, and small things (nav, reveals, card lights, the tilted
   product shot). The bots come from foods.js, the same code the app draws them with.
   Reduced motion: no idling, no pulses, no tilt; eyes still follow the cursor. */
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

  // Sections rise in as they scroll into view.
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.06 });
  document.querySelectorAll("[data-reveal]").forEach((el) => io.observe(el));

  // A soft light follows the cursor over cards.
  for (const el of document.querySelectorAll(".spot")) {
    el.addEventListener("pointermove", (e) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${e.clientX - r.left}px`);
      el.style.setProperty("--my", `${e.clientY - r.top}px`);
    });
  }

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
    const s = { rx: 0, ry: 0, ex: 0, ey: 0, lx: 32, ly: 24, sq: 0, sqv: 0, blinkAt: 1.6, blinkStart: -9, last: performance.now() };
    const set = (k, v) => bot.style.setProperty(k, v);
    whileVisible(bot, (now) => {
      const dt = Math.min(0.05, (now - s.last) / 1000);
      s.last = now;
      const t = now / 1000;
      const r = bot.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height * 0.45;
      let dx, dy, lx, ly, px, py;
      if (live()) {
        px = pointer.x;
        py = pointer.y;
        dx = clamp((px - cx) / (innerWidth * 0.45), -1, 1);
        dy = clamp((py - cy) / (innerHeight * 0.45), -1, 1);
        // over the glass the light sits under the cursor; outside it, on the edge facing it
        lx = clamp((px - r.left) / r.width, 0.12, 0.88) * 100;
        ly = clamp((py - r.top) / r.height, 0.1, 0.9) * 100;
      } else {
        const k = reduce ? 0 : t;
        dx = Math.sin(k * 0.45) * 0.6;
        dy = Math.sin(k * 0.31 + 1) * 0.35;
        lx = 50 + dx * 48;
        ly = 30 + dy * 40;
        px = cx + dx * 300;
        py = r.top + r.height * 0.28 + dy * 200;
      }
      const e = 1 - Math.pow(0.002, dt);
      s.ry = lerp(s.ry, dx * 13, e);
      s.rx = lerp(s.rx, -dy * 9, e);
      // the pupils look straight at the light
      const vx = px - cx, vy = py - (r.top + r.height * 0.28);
      const len = Math.hypot(vx, vy) || 1;
      const reach = Math.min(1, len / 180) / len;
      s.ex = lerp(s.ex, vx * reach, Math.min(1, e * 1.6));
      s.ey = lerp(s.ey, vy * reach, Math.min(1, e * 1.6));
      s.lx = lerp(s.lx, lx, e);
      s.ly = lerp(s.ly, ly, e);
      // a poke squashes it on a spring
      s.sqv += (-s.sq * 190 - s.sqv * 11) * dt;
      s.sq += s.sqv * dt;
      // blink now and then, sometimes twice
      if (!reduce && t > s.blinkAt) {
        s.blinkStart = t;
        s.blinkAt = t + (Math.random() < 0.25 ? 0.32 : rand(2.4, 5.5));
      }
      const bp = (t - s.blinkStart) / 0.17;
      const blink = bp >= 0 && bp <= 1 ? 1 - Math.sin(bp * Math.PI) * 0.92 : 1;

      set("--rx", `${s.rx.toFixed(2)}deg`);
      set("--ry", `${s.ry.toFixed(2)}deg`);
      set("--ex", s.ex.toFixed(3));
      set("--ey", s.ey.toFixed(3));
      set("--blink", blink.toFixed(3));
      set("--lx", `${s.lx.toFixed(1)}%`);
      set("--ly", `${s.ly.toFixed(1)}%`);
      set("--gx", `${(50 - (s.lx - 50) * 0.35).toFixed(1)}%`);
      set("--gy", `${(46 - (s.ly - 40) * 0.25).toFixed(1)}%`);
      set("--sa", `${(118 + (s.lx - 50) * 0.5).toFixed(1)}deg`);
      set("--shx", `${(50 + (s.lx - 50) * 0.9).toFixed(1)}%`);
      set("--sx", (1 + s.sq * 0.06).toFixed(4));
      set("--sy", (1 - s.sq * 0.08).toFixed(4));
    });

    // Poke it: it squashes, smiles, and a new agent pops out.
    let pops = 0, happyTimer = 0;
    const poke = () => {
      s.sqv += 7.5;
      bot.classList.add("happy");
      clearTimeout(happyTimer);
      happyTimer = setTimeout(() => bot.classList.remove("happy"), 1300);
      if (!F || reduce || bot.querySelectorAll(".pop").length > 6) return;
      const el = document.createElement("span");
      el.className = "pop";
      const side = Math.random() < 0.5 ? -1 : 1;
      el.style.setProperty("--dx", `${side * rand(130, 240)}px`);
      el.style.setProperty("--dy", `${-rand(70, 170)}px`);
      el.style.setProperty("--rot", `${side * rand(8, 28)}deg`);
      el.innerHTML = F.foodSvg({ seed: `pop${pops}`, food: pick(F.FOODS).id, tone: 1 + Math.floor(Math.random() * F.TONES), size: 64, expression: "happy", uid: `pop${pops++}`, title: "" });
      el.addEventListener("animationend", () => el.remove());
      bot.appendChild(el);
    };
    bot.addEventListener("pointerdown", poke);
    bot.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); poke(); } });
  }

  /* ---------- the product shot lies back, then stands up as you scroll ---------- */
  const shot = document.querySelector("[data-tilt] .window");
  if (shot && !reduce) {
    let queued = false;
    const update = () => {
      queued = false;
      const r = shot.getBoundingClientRect();
      const p = clamp(1 - (r.top - innerHeight * 0.18) / (innerHeight * 0.62), 0, 1);
      shot.style.setProperty("--tilt", `${((1 - p) * 24).toFixed(2)}deg`);
      shot.style.setProperty("--ts", (0.9 + 0.1 * p).toFixed(4));
    };
    addEventListener("scroll", () => { if (!queued) { queued = true; requestAnimationFrame(update); } }, { passive: true });
    addEventListener("resize", update);
    update();
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

  /* ---------- the crew: ten agents passing work along a graph ---------- */
  const crew = document.querySelector("[data-crew]");
  if (crew) {
    // name, x%, y% (wide), x%, y% (narrow). The name picks the bot, as in the app.
    const CREW = [
      ["Triage", 8, 50, 50, 8], ["Researcher", 24, 20, 18, 24], ["Coder", 25, 79, 82, 24],
      ["Archivist", 42, 48, 50, 38], ["Writer", 57, 18, 18, 53], ["Designer", 59, 79, 82, 53],
      ["Sage", 75, 46, 50, 67], ["Tester", 80, 83, 82, 83], ["Finance", 91, 17, 18, 83], ["Muse", 93, 58, 50, 94],
    ];
    const EDGES = [[0, 1], [0, 2], [1, 3], [2, 3], [3, 4], [3, 5], [4, 6], [5, 6], [5, 7], [6, 8], [6, 9], [4, 8], [7, 9]];
    const wires = crew.querySelector("svg.wires");
    const bots = CREW.map(([name], i) => {
      const el = document.createElement("div");
      el.className = "crew-bot";
      el.dataset.state = "idle";
      el.style.setProperty("--delay", `${-rand(0, 5).toFixed(2)}s`);
      el.innerHTML = `<span class="face"></span><b>${name}</b>`;
      crew.appendChild(el);
      return { el, face: el.firstChild, name, exp: "", busy: 0, tone: F.foodOf(`agent:${name.toLowerCase()}`).tone, i };
    });
    let size = 64;
    function draw(b, exp) {
      b.exp = exp;
      b.el.dataset.state = exp;
      b.face.innerHTML = F.foodSvg({ seed: `agent:${b.name.toLowerCase()}`, size, expression: exp, uid: `crew${b.i}`, title: b.name });
    }
    let paths = [];
    function layout() {
      const narrow = crew.clientWidth < 640;
      size = narrow ? 50 : 64;
      const W = crew.clientWidth, H = crew.clientHeight;
      const at = CREW.map(([, x, y, nx, ny]) => [((narrow ? nx : x) / 100) * W, ((narrow ? ny : y) / 100) * H]);
      bots.forEach((b, i) => {
        b.el.style.left = `${at[i][0]}px`;
        b.el.style.top = `${at[i][1]}px`;
        draw(b, b.exp || "idle");
      });
      // wires meet at the faces, above the name tags
      const lift = size / 2 - (size + 30) / 2;
      wires.setAttribute("viewBox", `0 0 ${W} ${H}`);
      wires.innerHTML = EDGES.map(([a, b]) => {
        const [ax, ay0] = at[a], [bx, by0] = at[b];
        const ay = ay0 + lift, by = by0 + lift;
        const dx = bx - ax, dy = by - ay;
        const c = Math.abs(dx) > Math.abs(dy)
          ? `C${ax + dx * 0.5} ${ay} ${bx - dx * 0.5} ${by}`
          : `C${ax} ${ay + dy * 0.5} ${bx} ${by - dy * 0.5}`;
        return `<path d="M${ax} ${ay} ${c} ${bx} ${by}"/>`;
      }).join("");
      paths = [...wires.querySelectorAll("path")];
    }
    new ResizeObserver(layout).observe(crew);
    layout();

    function pulse(edge, from) {
      const base = paths[edge];
      if (!base || reduce) return 700;
      const p = base.cloneNode();
      p.setAttribute("class", "pulse");
      p.style.color = `var(--food-${bots[from].tone})`;
      const len = base.getTotalLength();
      const seg = 52;
      p.style.strokeDasharray = `${seg} ${len + seg}`;
      wires.appendChild(p);
      const forward = EDGES[edge][0] === from;
      const dur = clamp(len * 2.4, 650, 1500);
      p.animate([{ strokeDashoffset: forward ? seg : -len }, { strokeDashoffset: forward ? -len : seg }], { duration: dur, easing: "cubic-bezier(.45,0,.25,1)" }).onfinish = () => p.remove();
      return dur;
    }

    let visible = false;
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(crew);
    function work() {
      if (!visible || document.hidden || reduce) return;
      const now = performance.now();
      const free = EDGES.map((e, i) => [e, i]).filter(([[a, b]]) => bots[a].busy < now && bots[b].busy < now);
      if (!free.length) return;
      const [[a0, b0], edge] = pick(free);
      const [a, b] = Math.random() < 0.5 ? [a0, b0] : [b0, a0];
      bots[a].busy = bots[b].busy = now + 5200;
      draw(bots[a], "thinking");
      setTimeout(() => {
        const dur = pulse(edge, a);
        setTimeout(() => { draw(bots[a], "happy"); draw(bots[b], "thinking"); }, dur);
        setTimeout(() => draw(bots[a], "idle"), dur + 2000);
        setTimeout(() => draw(bots[b], Math.random() < 0.12 ? "sad" : "happy"), dur + 1500);
        setTimeout(() => draw(bots[b], "idle"), dur + 3400);
      }, 700);
    }
    setInterval(work, 1150);

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
