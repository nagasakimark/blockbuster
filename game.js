// BLOCKBUSTER — hexagon picture-reveal game (canvas)
(() => {
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const $ = (id) => document.getElementById(id);

  // ---------------------------------------------------------------- state
  let W = 0, H = 0, DPR = 1;
  let hexes = [];
  let R = 80;
  let particles = [];
  let images = {};            // src -> HTMLImageElement
  let bgCache = null;         // offscreen canvas with blurred + fitted picture
  let bgCacheKey = "";

  const game = {
    mode: "title",            // title | play | end
    set: null,
    order: [],
    index: 0,
    revealed: false,          // SHOW pressed
    transitioning: false,
    label: null,              // {text, t0}
    points: 0,
    awarded: false,
    teams: false,
    flash: false,             // flash mode on/off
    flashHex: null,           // tile currently lit
    flashTimer: 0,
    flashPause: 0,            // short pause after a hit
    score: { red: 0, blue: 0 },
  };

  let soundOn = true;
  let hoverHex = null;
  let lastTime = performance.now();

  // ---------------------------------------------------------------- audio
  let actx = null;
  function audio() {
    if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
    if (actx && actx.state === "suspended") actx.resume();
    return actx;
  }
  function tone(freq, freq2, dur, type = "sine", vol = 0.25, delay = 0) {
    if (!soundOn) return;
    const a = audio(); if (!a) return;
    const t = a.currentTime + delay;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(30, freq2), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }
  const sfx = {
    tick()  { tone(1400, 1400, 0.03, "square", 0.035); },
    pop()   { const f = 500 + Math.random() * 300; tone(f, f * 2.2, 0.09, "sine", 0.3); tone(f * 0.5, 80, 0.12, "triangle", 0.15); },
    reveal(){ [523, 659, 784, 1047].forEach((f, i) => tone(f, f, 0.22, "triangle", 0.18, i * 0.08)); },
    whoosh(){ tone(200, 900, 0.35, "sawtooth", 0.04); },
    point() { tone(880, 1320, 0.15, "square", 0.08); tone(1320, 1760, 0.2, "square", 0.06, 0.1); },
    fanfare(){ [523, 523, 523, 659, 784, 659, 784, 1047].forEach((f, i) => tone(f, f, 0.18, "triangle", 0.18, i * 0.12)); },
  };

  // ---------------------------------------------------------------- helpers
  const easeOutBack = (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
  const easeInBack = (t) => { const c1 = 1.70158, c3 = c1 + 1; return c3 * t * t * t - c1 * t * t; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const shuffle = (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };

  function hexPath(x, y, r) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i;
      const px = x + r * Math.cos(a), py = y + r * Math.sin(a);
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
  }
  function inHex(px, py, h) {
    const dx = Math.abs(px - h.x), dy = Math.abs(py - h.y);
    const s3 = Math.sqrt(3);
    return dy <= (s3 / 2) * R && s3 * dx + dy <= s3 * R;
  }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  // ---------------------------------------------------------------- layout
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    buildGrid(true);
    bgCacheKey = "";
  }

  // Build hexagon grid that covers the whole screen (~36 tiles like the PowerPoint)
  function buildGrid(keepState) {
    const old = new Map(hexes.map((h) => [h.c + "," + h.r, h]));
    R = Math.sqrt((W * H) / (36 * 2.598));
    R = clamp(R, 50, 200);
    const s3 = Math.sqrt(3);
    const colW = 1.5 * R, rowH = s3 * R;
    const cols = Math.ceil(W / colW) + 2;
    const rows = Math.ceil(H / rowH) + 2;
    const ox = (W - (cols - 1) * colW) / 2;
    const oy = (H - (rows - 1) * rowH) / 2;
    const next = [];
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const x = ox + c * colW;
        const y = oy + r * rowH + (c % 2 ? rowH / 2 : 0);
        if (x + R < 0 || x - R > W || y + rowH / 2 < 0 || y - rowH / 2 > H) continue;
        const prev = keepState ? old.get(c + "," + r) : null;
        next.push(prev ? Object.assign(prev, { x, y }) : {
          x, y, c, r, state: "covered", t: 0, delay: 0, rot: 0, shade: Math.random(),
        });
      }
    }
    hexes = next;
  }

  function coveredCount() { return hexes.filter((h) => h.state === "covered" || h.state === "returning").length; }

  // ---------------------------------------------------------------- picture
  function currentItem() { return game.set ? game.set.items[game.order[game.index]] : null; }

  function buildBg() {
    const item = currentItem();
    if (!item) return null;
    const img = images[item.image];
    if (!img || !img.complete || !img.naturalWidth) return null;
    const key = item.image + "|" + W + "x" + H;
    if (key === bgCacheKey && bgCache) return bgCache;
    const c = document.createElement("canvas");
    c.width = Math.round(W * DPR); c.height = Math.round(H * DPR);
    const g = c.getContext("2d");
    g.scale(DPR, DPR);
    const iw = img.naturalWidth, ih = img.naturalHeight;
    // blurred "cover" background
    const cs = Math.max(W / iw, H / ih) * 1.1;
    g.filter = "blur(24px) brightness(0.8)";
    g.drawImage(img, (W - iw * cs) / 2, (H - ih * cs) / 2, iw * cs, ih * cs);
    g.filter = "none";
    // sharp "contain" picture on top
    const s = Math.min(W / iw, H / ih);
    const dw = iw * s, dh = ih * s;
    g.shadowColor = "rgba(0,0,0,.5)"; g.shadowBlur = 30;
    g.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
    bgCache = c; bgCacheKey = key;
    return c;
  }

  // ---------------------------------------------------------------- game flow
  function loadImages(list, onProgress) {
    let done = 0;
    return Promise.all(list.map((src) => new Promise((res) => {
      if (images[src] && images[src].complete) { done++; onProgress && onProgress(done / list.length); return res(); }
      const im = new Image();
      im.onload = im.onerror = () => { done++; onProgress && onProgress(done / list.length); res(); };
      im.src = src;
      images[src] = im;
    })));
  }

  async function startSet(set) {
    game.set = set;
    game.teams = $("optTeams").checked;
    setFlash($("optFlash").checked);
    game.order = set.items.map((_, i) => i);
    if ($("optShuffle").checked) shuffle(game.order);
    game.index = 0;
    game.score = { red: 0, blue: 0 };
    updateScores();
    $("loading").classList.remove("hidden");
    await loadImages([...new Set(set.items.map((i) => i.image))], (p) => { $("loadPct").textContent = Math.round(p * 100) + "%"; });
    $("loading").classList.add("hidden");
    $("title").classList.add("hidden");
    $("end").classList.add("hidden");
    $("hud").classList.remove("hidden");
    $("teamScores").classList.toggle("hidden", !game.teams);
    game.mode = "play";
    audio();
    startRound(true);
  }

  function startRound(fresh) {
    game.revealed = false;
    game.awarded = false;
    game.label = null;
    game.transitioning = false;
    bgCacheKey = "";
    buildGrid(false); // fresh grid, every tile covered
    $("roundPill").textContent = (game.index + 1) + " / " + game.order.length;
    $("btnShow").classList.remove("hidden");
    $("btnNext").classList.add("hidden");
    $("award").classList.add("hidden");
    $("btnRandom").disabled = false;
    game.flashHex = null; game.flashTimer = 0; game.flashPause = 0.4;
    $("btnPrev").style.visibility = game.index > 0 ? "visible" : "hidden";
  }

  function popHex(h, silent) {
    if (h.state !== "covered") return;
    h.state = "popping"; h.t = 0; h.delay = 0;
    h.rot = (Math.random() - 0.5) * 1.2;
    if (!silent) sfx.pop();
    // shards
    for (let i = 0; i < 9; i++) {
      const a = Math.random() * Math.PI * 2, sp = 150 + Math.random() * 350;
      particles.push({
        x: h.x + Math.cos(a) * R * 0.4, y: h.y + Math.sin(a) * R * 0.4,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 200,
        r: R * (0.08 + Math.random() * 0.1), life: 0.9, max: 0.9,
        rot: Math.random() * 6, vr: (Math.random() - 0.5) * 12, kind: "hex",
        color: Math.random() < 0.3 ? "#ffffff" : "#1c87e0",
      });
    }
  }

  function randomTile() {
    if (game.mode !== "play" || game.revealed || game.transitioning) return;
    // prefer tiles that are mostly on-screen
    const list = hexes.filter((h) => h.state === "covered" && h.x > R * 0.3 && h.x < W - R * 0.3 && h.y > R * 0.3 && h.y < H - R * 0.3);
    const pool = list.length ? list : hexes.filter((h) => h.state === "covered");
    if (!pool.length) return;
    popHex(pool[(Math.random() * pool.length) | 0]);
  }

  // ---- flash mode
  const FLASH_SPEED = 0.09;   // seconds each tile stays lit
  function flashPool() {
    const list = hexes.filter((h) => h.state === "covered" && h.x > R * 0.3 && h.x < W - R * 0.3 && h.y > R * 0.3 && h.y < H - R * 0.3);
    return list.length ? list : hexes.filter((h) => h.state === "covered");
  }
  function setFlash(on) {
    game.flash = on;
    game.flashHex = null; game.flashTimer = 0; game.flashPause = 0.3;
    $("btnFlash").classList.toggle("on", on);
    $("btnRandom").classList.toggle("hidden", on);
  }
  function flashActive() { return game.flash && game.mode === "play" && !game.revealed && !game.transitioning; }
  function updateFlash(dt) {
    if (!flashActive()) { game.flashHex = null; return; }
    if (game.flashPause > 0) { game.flashPause -= dt; game.flashHex = null; return; }
    game.flashTimer -= dt;
    if (game.flashTimer > 0 && game.flashHex && game.flashHex.state === "covered") return;
    const pool = flashPool();
    if (!pool.length) { game.flashHex = null; return; }
    let h = pool[(Math.random() * pool.length) | 0];
    if (pool.length > 1) while (h === game.flashHex) h = pool[(Math.random() * pool.length) | 0];
    game.flashHex = h;
    game.flashTimer = FLASH_SPEED;
    sfx.tick();
  }
  function hitFlash() {
    if (!flashActive() || !game.flashHex) return;
    popHex(game.flashHex);
    game.flashHex = null;
    game.flashPause = 0.6; // give everyone a moment to look
  }

  function showAnswer() {
    if (game.mode !== "play" || game.revealed || game.transitioning) return;
    game.revealed = true;
    game.points = Math.max(1, hexes.filter((h) => h.state === "covered").length);
    const cx = W / 2, cy = H / 2, maxD = Math.hypot(cx, cy);
    hexes.forEach((h) => {
      if (h.state !== "covered") return;
      h.state = "waiting";
      h.delay = (Math.hypot(h.x - cx, h.y - cy) / maxD) * 0.6;
      h.t = 0;
    });
    const item = currentItem();
    game.label = { text: item.word, t0: performance.now() + 450 };
    setTimeout(() => {
      sfx.reveal();
      confetti(W / 2, H * 0.12);
    }, 450);
    $("btnShow").classList.add("hidden");
    $("btnNext").classList.remove("hidden");
    $("btnRandom").disabled = true;
    game.flashHex = null;
    if (game.teams) {
      document.querySelectorAll("#award .pts").forEach((el) => (el.textContent = game.points));
      $("award").classList.remove("hidden");
    }
  }

  function award(team) {
    if (game.awarded) return;
    game.awarded = true;
    game.score[team] += game.points;
    sfx.point();
    updateScores(team);
    $("award").classList.add("hidden");
  }

  function updateScores(bumpTeam) {
    $("scoreRed").textContent = game.score.red;
    $("scoreBlue").textContent = game.score.blue;
    if (bumpTeam) {
      const el = bumpTeam === "red" ? $("scoreRed").parentElement : $("scoreBlue").parentElement;
      el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump");
    }
  }

  function goTo(newIndex) {
    if (game.mode !== "play" || game.transitioning) return;
    if (newIndex < 0) return;
    if (newIndex >= game.order.length) return endGame();
    game.transitioning = true;
    sfx.whoosh();
    // tiles fly back in over the current picture, then swap
    const cx = W / 2, cy = H / 2, maxD = Math.hypot(cx, cy);
    hexes.forEach((h) => {
      if (h.state === "covered") return;
      h.state = "returning"; h.t = 0;
      h.delay = (1 - Math.hypot(h.x - cx, h.y - cy) / maxD) * 0.3;
    });
    setTimeout(() => {
      game.label = null;
      game.index = newIndex;
      startRound(false);
    }, 750);
  }

  function next() { goTo(game.index + 1); }
  function prev() { goTo(game.index - 1); }

  function endGame() {
    game.mode = "end";
    game.label = null;
    $("hud").classList.add("hidden");
    $("end").classList.remove("hidden");
    const es = $("endScores");
    if (game.teams) {
      const { red, blue } = game.score;
      es.innerHTML =
        `<div class="score red ${red > blue ? "win" : ""}">${red > blue ? '<span class="crown">👑</span>' : ""}<span class="team-name">RED</span>${red}</div>` +
        `<div class="score blue ${blue > red ? "win" : ""}">${blue > red ? '<span class="crown">👑</span>' : ""}<span class="team-name">BLUE</span>${blue}</div>`;
      es.classList.remove("hidden");
    } else es.classList.add("hidden");
    sfx.fanfare();
    for (let i = 0; i < 4; i++) setTimeout(() => confetti(W * (0.2 + 0.2 * i), H * 0.3), i * 200);
    // cover the screen again behind the card
    hexes.forEach((h) => { if (h.state !== "covered") { h.state = "returning"; h.t = 0; h.delay = Math.random() * 0.4; } });
  }

  function goHome() {
    game.mode = "title";
    game.label = null;
    $("hud").classList.add("hidden");
    $("end").classList.add("hidden");
    $("title").classList.remove("hidden");
    hexes.forEach((h) => { if (h.state !== "covered") { h.state = "returning"; h.t = 0; h.delay = Math.random() * 0.3; } });
  }

  function confetti(x, y) {
    const colors = ["#ff9f1c", "#13b24b", "#ef3e4a", "#ffd23f", "#ffffff", "#2a5bd7"];
    for (let i = 0; i < 60; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.4, sp = 250 + Math.random() * 500;
      particles.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: 5 + Math.random() * 6,
        life: 2 + Math.random(), max: 3, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 14,
        kind: "rect", color: colors[(Math.random() * colors.length) | 0],
      });
    }
  }

  // ---------------------------------------------------------------- update / draw
  function update(dt) {
    updateFlash(dt);
    for (const h of hexes) {
      if (h.delay > 0) { h.delay -= dt; continue; }
      if (h.state === "waiting") { h.state = "covered"; popHex(h, Math.random() > 0.25); continue; }
      if (h.state === "popping") { h.t += dt / 0.45; if (h.t >= 1) { h.state = "gone"; h.t = 1; } }
      else if (h.state === "returning") { h.t += dt / 0.4; if (h.t >= 1) { h.state = "covered"; h.t = 1; } }
    }
    for (const p of particles) {
      p.vy += 900 * dt; p.vx *= 0.99;
      p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt; p.life -= dt;
    }
    particles = particles.filter((p) => p.life > 0 && p.y < H + 50);
  }

  function drawTile(h, scale, alpha, rot) {
    if (scale <= 0.01 || alpha <= 0.01) return;
    const r = R * scale;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(h.x, h.y);
    ctx.rotate(rot);
    const lit = h === game.flashHex;
    const hover = !game.flash && h === hoverHex && game.mode === "play" && !game.revealed;
    // body gradient
    const grad = ctx.createLinearGradient(0, -r, 0, r);
    const light = lit ? "#cfe9ff" : hover ? "#6cc0ff" : "#3aa3f5";
    const dark = lit ? "#9fd2fb" : hover ? "#2a95ec" : (h.shade > 0.5 ? "#1a7fd6" : "#1c87e0");
    grad.addColorStop(0, light); grad.addColorStop(0.55, dark); grad.addColorStop(1, lit ? "#7dbcf0" : "#1467b5");
    hexPath(0, 0, r);
    ctx.fillStyle = grad; ctx.fill();
    ctx.shadowBlur = 0; ctx.shadowColor = "transparent";
    // inner bevel shine
    hexPath(0, -r * 0.04, r * 0.78);
    ctx.strokeStyle = "rgba(255,255,255,.18)"; ctx.lineWidth = r * 0.05; ctx.stroke();
    // outline
    hexPath(0, 0, r);
    ctx.strokeStyle = "#000"; ctx.lineWidth = Math.max(3, R * 0.06); ctx.lineJoin = "round"; ctx.stroke();
    ctx.restore();
  }

  function draw(now) {
    ctx.clearRect(0, 0, W, H);
    // picture (only while playing)
    const bg = game.mode === "play" ? buildBg() : null;
    if (bg) ctx.drawImage(bg, 0, 0, W, H);
    else { ctx.fillStyle = "#0f5fa8"; ctx.fillRect(0, 0, W, H); }

    // tiles
    for (const h of hexes) {
      if (h.state === "gone") continue;
      if (h.state === "covered" || h.state === "waiting") {
        if (h === game.flashHex) continue; // drawn last, on top
        const s = !game.flash && h === hoverHex && game.mode === "play" && !game.revealed ? 1.04 : 1;
        drawTile(h, s, 1, 0);
      } else if (h.state === "popping") {
        const t = h.t;
        drawTile(h, 1 - easeInBack(t) * 1, 1 - t * t, h.rot * t);
      } else if (h.state === "returning") {
        if (h.delay > 0 && h.t === 0) continue; // still waiting to fly in
        const t = clamp(h.t, 0, 1);
        drawTile(h, easeOutBack(t), Math.min(1, t * 2), (1 - t) * 0.5);
      }
    }

    if (game.flashHex) drawTile(game.flashHex, 1, 1, 0);

    // particles
    for (const p of particles) {
      ctx.save();
      ctx.globalAlpha = clamp(p.life / p.max * 1.5, 0, 1);
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.kind === "hex") { hexPath(0, 0, p.r); ctx.fill(); ctx.strokeStyle = "#000"; ctx.lineWidth = 2; ctx.stroke(); }
      else ctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2);
      ctx.restore();
    }

    // answer label
    if (game.label && now >= game.label.t0) {
      const t = clamp((now - game.label.t0) / 500, 0, 1);
      const s = easeOutBack(t);
      const fs = clamp(H * 0.12, 34, 110);
      ctx.save();
      ctx.font = `700 ${fs}px Fredoka, "M PLUS Rounded 1c", sans-serif`;
      const tw = ctx.measureText(game.label.text).width;
      const bw = tw + fs * 1.0, bh = fs * 1.35;
      ctx.translate(W / 2, fs * 0.25 + bh / 2 + 6);
      ctx.scale(s, s);
      ctx.shadowColor = "rgba(0,0,0,.45)"; ctx.shadowBlur = 18; ctx.shadowOffsetY = 6;
      roundRect(-bw / 2, -bh / 2, bw, bh, fs * 0.28);
      ctx.fillStyle = "#000"; ctx.fill();
      ctx.shadowColor = "transparent";
      ctx.lineWidth = 4; ctx.strokeStyle = "#fff"; ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(game.label.text, 0, fs * 0.04);
      ctx.restore();
    }
  }

  function loop(now) {
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;
    update(dt);
    draw(now);
    requestAnimationFrame(loop);
  }

  // ---------------------------------------------------------------- input
  function pointerPos(e) { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  function hexAt(x, y) { return hexes.find((h) => h.state === "covered" && inHex(x, y, h)) || null; }

  canvas.addEventListener("pointerdown", (e) => {
    if (game.mode !== "play" || game.revealed || game.transitioning) return;
    if (game.flash) return hitFlash(); // click anywhere hits the lit tile
    const [x, y] = pointerPos(e);
    const h = hexAt(x, y);
    if (h) popHex(h);
  });
  canvas.addEventListener("pointermove", (e) => {
    const [x, y] = pointerPos(e);
    hoverHex = game.mode === "play" ? hexAt(x, y) : null;
    canvas.style.cursor = game.flash && !game.revealed ? "crosshair" : hoverHex && !game.revealed ? "pointer" : "default";
  });
  canvas.addEventListener("pointerleave", () => (hoverHex = null));

  window.addEventListener("keydown", (e) => {
    if (game.mode !== "play") return;
    if (e.key === " " && flashActive()) { e.preventDefault(); hitFlash(); }
    else if (e.key === " " || e.key === "Enter") { e.preventDefault(); game.revealed ? next() : showAnswer(); }
    else if (e.key.toLowerCase() === "f") setFlash(!game.flash);
    else if (e.key === "ArrowRight") next();
    else if (e.key === "ArrowLeft") prev();
    else if (e.key.toLowerCase() === "r") randomTile();
    else if (e.key === "1" && game.teams && game.revealed) award("red");
    else if (e.key === "2" && game.teams && game.revealed) award("blue");
  });

  $("btnShow").onclick = showAnswer;
  $("btnNext").onclick = next;
  $("btnPrev").onclick = prev;
  $("btnRandom").onclick = randomTile;
  $("btnFlash").onclick = () => setFlash(!game.flash);
  $("btnAwardRed").onclick = () => award("red");
  $("btnAwardBlue").onclick = () => award("blue");
  $("btnHome").onclick = goHome;
  $("btnMenu").onclick = goHome;
  $("btnAgain").onclick = () => startSet(game.set);
  $("btnSound").onclick = () => {
    soundOn = !soundOn;
    $("btnSound").textContent = soundOn ? "🔊" : "🔇";
  };
  $("btnFull").onclick = () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  };
  // stop buttons from stealing Space/Enter focus
  document.querySelectorAll("button").forEach((b) => b.addEventListener("keydown", (e) => { if (e.key === " " || e.key === "Enter") e.preventDefault(); }));

  // ---------------------------------------------------------------- title screen
  function buildSetList() {
    const list = $("setList");
    list.innerHTML = "";
    SETS.forEach((set) => {
      const b = document.createElement("button");
      b.className = "set-btn";
      b.innerHTML =
        `<span class="thumb" style="background-image:url('${set.items[0].image}')"></span>` +
        `<span class="label">${set.title}<small>${set.titleJa || ""} ・ ${set.items.length} pictures</small></span>` +
        `<span class="play">▶ PLAY</span>`;
      b.onclick = () => startSet(set);
      list.appendChild(b);
    });
  }

  window.addEventListener("resize", resize);
  resize();
  hexes.forEach((h) => (h.state = "covered"));
  buildSetList();
  requestAnimationFrame(loop);
})();
