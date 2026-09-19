import { GameEngine, Blade, OneEuroFilter, FRUITS, clamp } from "./core.js";
import { HandTracker, CONNECTIONS } from "./hand.js";

const $ = (id) => document.getElementById(id);
const arena = $("arena"),
  canvas = $("game"),
  ctx = canvas.getContext("2d");
const previewCanvas = $("camera-skeleton"),
  previewCtx = previewCanvas.getContext("2d");
const blade = new Blade(),
  filterX = new OneEuroFilter(),
  filterY = new OneEuroFilter();
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const storage = {
  get(key, fallback) {
    try {
      return localStorage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {}
  },
};
let phase = "menu",
  control = "pointer",
  mode = "arcade",
  pauseReason = null,
  width = 1000,
  height = 640;
let particles = [],
  fragments = [],
  popups = [],
  shake = 0,
  flash = 0,
  pointerDown = false,
  pointerId = null;
let landmarks = null,
  hasHand = false,
  lastHandTime = -Infinity,
  lostSince = null;
let countdown = 3,
  lastCountdown = null,
  countdownResume = false,
  previousTime = performance.now(),
  operation = 0;
const bestFor = (m) =>
  Math.max(0, Number(storage.get(`slice-club-best-${m}`, "0")) || 0);
const text = (id, value) => {
  const node = $(id);
  const str = String(value);
  if (node.textContent !== str) node.textContent = str;
};
const show = (id, yes = true) => {
  $(id).hidden = !yes;
};

class Sound {
  constructor() {
    this.muted = storage.get("slice-club-muted", "false") === "true";
  }
  unlock() {
    try {
      this.audio ??= new (window.AudioContext || window.webkitAudioContext)();
      if (this.audio.state === "suspended") this.audio.resume().catch(() => {});
    } catch {}
  }
  tone(frequency, end, length = 0.1, delay = 0, type = "sine", volume = 0.09) {
    if (this.muted || !this.audio || this.audio.state !== "running") return;
    const at = this.audio.currentTime + delay,
      osc = this.audio.createOscillator(),
      gain = this.audio.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, at);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, end), at + length);
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(volume, at + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, at + length);
    osc.connect(gain).connect(this.audio.destination);
    osc.start(at);
    osc.stop(at + length + 0.01);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }
  slice(combo) {
    this.tone(380 + Math.min(combo, 8) * 90, 150, 0.13, 0, "triangle", 0.12);
    if (combo >= 3) this.tone(800 + combo * 40, 1200, 0.1, 0.06, "sine", 0.05);
  }
  bomb() {
    this.tone(130, 25, 0.5, 0, "sawtooth", 0.08);
    this.tone(75, 20, 0.4, 0, "triangle", 0.16);
  }
  finish() {
    [523, 659, 784, 1047].forEach((f, i) =>
      this.tone(f, f, 0.22, i * 0.11, "triangle", 0.09),
    );
  }
}
const sound = new Sound();
function updateSoundButton() {
  $("sound-button").setAttribute("aria-pressed", String(sound.muted));
  $("sound-button").setAttribute(
    "aria-label",
    sound.muted ? "Enable sound" : "Mute sound",
  );
  text("sound-button", sound.muted ? "♪" : "♫");
}
updateSoundButton();

// Cache native color-emoji artwork once, rather than shaping text every frame.
const sprites = [...FRUITS.map((f) => f.emoji), "💣"].map((emoji) => {
  const sprite = document.createElement("canvas");
  sprite.width = sprite.height = 192;
  const c = sprite.getContext("2d");
  c.font =
    '145px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText(emoji, 96, 102);
  return sprite;
});
function spriteFor(fruit) {
  return sprites[fruit.bomb ? FRUITS.length : fruit.kind];
}

function burst(event) {
  const f = event.fruit,
    bomb = event.type === "bomb";
  const color = bomb ? "#ff7b8e" : FRUITS[f.kind].color;
  const count = reducedMotion ? 8 : bomb ? 34 : 22;
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2,
      speed = 60 + Math.random() * (bomb ? 330 : 250);
    particles.push({
      x: f.x,
      y: f.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 65,
      life: 0.4 + Math.random() * 0.45,
      total: 0.85,
      radius: 2 + Math.random() * 5,
      color: i % 5 === 0 ? "#fff8d5" : color,
    });
  }
  particles = particles.slice(-360);
  if (!bomb) {
    const angle = event.angle;
    for (const side of [-1, 1])
      fragments.push({
        ...f,
        sliceAngle: angle,
        side,
        vx: f.vx * 0.35 - Math.sin(angle) * side * 135,
        vy: f.vy * 0.2 + Math.cos(angle) * side * 135,
        spin: side * 1.7,
        rotation: 0,
        life: 0.7,
      });
    fragments = fragments.slice(-70);
    sound.slice(event.combo);
    popups.push({
      x: f.x,
      y: f.y - 10,
      label: `+${event.points}`,
      color: "#e2ff7a",
      life: 0.75,
      large: false,
    });
    if (event.combo >= 3) {
      popups = popups.filter((p) => !p.large);
      popups.push({
        x: width / 2,
        y: height * 0.32,
        label: `${event.combo} FRUIT COMBO!`,
        color: "#d6fd51",
        life: 1,
        large: true,
      });
    }
  } else {
    sound.bomb();
    shake = reducedMotion ? 0 : 0.3;
    flash = reducedMotion ? 0 : 0.17;
    popups.push({
      x: f.x,
      y: f.y,
      label: "OUCH! −30",
      color: "#ff91b4",
      life: 1,
      large: false,
    });
    text("announcer", "Bomb hit. 30 points deducted.");
  }
  popups = popups.slice(-24);
}
const engine = new GameEngine(width, height, (event) => {
  if (event.type === "finish") finishRound();
  else burst(event);
});
const tracker = new HandTracker(
  $("camera-video"),
  receiveLandmarks,
  (message) => {
    home();
    text("setup-status", message);
    text("announcer", message);
  },
);

function clearInput() {
  blade.clear();
  pointerDown = false;
  pointerId = null;
  filterX.reset();
  filterY.reset();
}
function receiveLandmarks(points, sampleTime) {
  const now = performance.now() / 1000;
  if (!points || points.length !== 21) {
    hasHand = false;
    landmarks = null;
    clearInput();
    return;
  }
  const reacquired = !hasHand;
  hasHand = true;
  lastHandTime = now;
  lostSince = null;
  if (reacquired && phase === "paused" && pauseReason === "hand") play();
  landmarks = points;
  if (reacquired) {
    blade.clear();
    filterX.reset();
    filterY.reset();
  }
  const tip = points[8];
  const point = {
    x: filterX.filter(clamp(1 - tip.x, 0, 1) * width, sampleTime),
    y: filterY.filter(clamp(tip.y, 0, 1) * height, sampleTime),
  };
  const segment = blade.move(point, sampleTime, {
    active: phase === "playing",
    hand: true,
    width,
    height,
  });
  if (segment && phase === "playing") engine.slice(...segment);
}
function syncBest() {
  text("welcome-best", bestFor(mode));
  text("best", bestFor(mode));
}
syncBest();

async function startRound(input) {
  const token = ++operation;
  control = input;
  sound.unlock();
  clearInput();
  tracker.stop();
  hasHand = false;
  landmarks = null;
  lastHandTime = -Infinity;
  lostSince = null;
  mode = document.querySelector('input[name="mode"]:checked').value;
  syncBest();
  particles = [];
  fragments = [];
  popups = [];
  shake = flash = 0;
  if (input === "hand") {
    phase = "setup";
    $("camera-start").disabled = true;
    try {
      const started = await tracker.start((message) =>
        text("setup-status", message),
      );
      if (token !== operation || !started) return;
    } catch (error) {
      if (token !== operation) return;
      phase = "menu";
      text("setup-status", error.message);
      $("camera-start").disabled = false;
      return;
    }
  }
  if (token !== operation) return;
  $("camera-start").disabled = false;
  text("setup-status", "");
  engine.start(mode);
  engine.pause();
  show("welcome", false);
  show("results", false);
  show("pause-panel", false);
  show("hud");
  show("game-footer");
  show("camera-preview", input === "hand");
  text("mode-label", mode.toUpperCase());
  text(
    "rule-hint",
    mode === "zen" ? "JUST FRUIT. FIND YOUR FLOW." : "FRUIT +10  /  BOMBS −30",
  );
  updateHUD();
  beginCountdown(false);
  canvas.focus({ preventScroll: true });
}
function beginCountdown(resume) {
  phase = "countdown";
  countdownResume = resume;
  countdown = 3;
  lastCountdown = null;
  show("countdown");
  show("pause-panel", false);
  show("hand-notice", false);
  clearInput();
  text("countdown-number", control === "hand" && !hasHand ? "✋" : "3");
  text(
    "countdown-hint",
    control === "hand"
      ? "Raise one hand. Your index finger is the blade."
      : "Hold and drag to slice. Lift to dodge.",
  );
}
function play() {
  engine.resume();
  phase = "playing";
  pauseReason = null;
  clearInput();
  lostSince = null;
  show("countdown", false);
  sound.tone(700, 1100, 0.18);
  text(
    "announcer",
    `${mode === "zen" ? "Zen" : "Arcade"} round ${countdownResume ? "resumed" : "started"}.`,
  );
}
function pause(reason = "manual") {
  if (phase !== "playing" && phase !== "countdown") return;
  phase = "paused";
  pauseReason = reason;
  engine.pause();
  clearInput();
  show("countdown", false);
  show("hand-notice", false);
  show("pause-panel");
  text("pause-title", reason === "hand" ? "HAND CHECK." : "ON ICE.");
  text(
    "pause-copy",
    reason === "hand"
      ? "Your hand left the frame. Bring it back, then keep slicing."
      : reason === "away"
        ? "We paused the round while you were away."
        : "Your fruit can wait.",
  );
  $("resume-button").focus({ preventScroll: true });
}
function home() {
  operation++;
  tracker.stop();
  engine.state = "idle";
  engine.entities = [];
  phase = "menu";
  pauseReason = null;
  clearInput();
  hasHand = false;
  landmarks = null;
  particles = [];
  fragments = [];
  popups = [];
  for (const id of [
    "hud",
    "game-footer",
    "camera-preview",
    "countdown",
    "hand-notice",
    "pause-panel",
    "results",
  ])
    show(id, false);
  show("welcome");
  $("camera-start").disabled = false;
  text("setup-status", "");
  syncBest();
}
function finishRound() {
  phase = "finished";
  clearInput();
  tracker.stop();
  hasHand = false;
  landmarks = null;
  const oldBest = bestFor(mode),
    newBest = engine.score > oldBest;
  if (newBest) storage.set(`slice-club-best-${mode}`, String(engine.score));
  text(
    "result-kicker",
    newBest ? "A NEW PERSONAL BEST!" : `${mode.toUpperCase()} · ROUND COMPLETE`,
  );
  text(
    "result-title",
    engine.score >= 500
      ? "ABSOLUTE JUICE."
      : engine.sliced
        ? "FRESH WORK."
        : "WARM-UP DONE.",
  );
  text("result-score", engine.score);
  text("result-fruit", engine.sliced);
  text("result-combo", engine.maxCombo);
  text("result-bombs", engine.bombs);
  show("camera-preview", false);
  show("hand-notice", false);
  show("results");
  syncBest();
  sound.finish();
  text(
    "announcer",
    `Round complete. ${engine.score} points. ${engine.sliced} fruit sliced. ${newBest ? "New personal best!" : ""}`,
  );
  $("play-again").focus({ preventScroll: true });
}
function updateHUD() {
  text("score", String(engine.score).padStart(3, "0"));
  text("timer", Math.ceil(engine.remaining));
  text(
    "combo",
    engine.combo >= 3
      ? `✦ ${engine.combo} FRUIT COMBO`
      : engine.combo > 0
        ? "KEEP IT FLOWING…"
        : "LET’S MAKE A MESS",
  );
  $("timer").parentElement.classList.toggle("urgent", engine.remaining <= 10);
}

function drawSprite(f) {
  const size = f.radius * 2.6;
  ctx.save();
  ctx.translate(f.x, f.y);
  ctx.rotate(f.angle);
  if (f.bomb) {
    ctx.beginPath();
    ctx.arc(0, 4, f.radius * 1.1, 0, Math.PI * 2);
    ctx.strokeStyle = "#ff688977";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.drawImage(spriteFor(f), -size / 2, -size / 2, size, size);
  ctx.restore();
}
function drawFragments(dt) {
  for (const f of fragments) {
    if (phase !== "paused") {
      f.life -= dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.vy += height * 0.9 * dt;
      f.rotation += f.spin * dt;
    }
    const size = f.radius * 2.6;
    ctx.save();
    ctx.globalAlpha = clamp(f.life / 0.35, 0, 1);
    ctx.translate(f.x, f.y);
    ctx.rotate(f.sliceAngle + f.rotation);
    ctx.beginPath();
    ctx.rect(-size, f.side < 0 ? -size : 0, size * 2, size);
    ctx.clip();
    ctx.rotate(f.angle - f.sliceAngle);
    ctx.drawImage(spriteFor(f), -size / 2, -size / 2, size, size);
    ctx.restore();
  }
  fragments = fragments.filter((f) => f.life > 0);
}
function drawParticles(dt) {
  for (const p of particles) {
    if (phase !== "paused") {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 390 * dt;
    }
    ctx.globalAlpha = clamp(p.life / 0.35, 0, 1);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.ellipse(
      p.x,
      p.y,
      p.radius,
      p.radius * 0.7,
      Math.atan2(p.vy, p.vx),
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  particles = particles.filter((p) => p.life > 0);
}
function drawSkeleton(target, w, h, preview = false) {
  if (!landmarks || !hasHand) return;
  const points = landmarks.map((p) => ({ x: (1 - p.x) * w, y: p.y * h }));
  target.save();
  target.lineWidth = preview ? 1.6 : 2;
  target.strokeStyle = preview ? "#d6fd51cc" : "#bfa0f277";
  target.lineCap = "round";
  for (const [a, b] of CONNECTIONS) {
    target.beginPath();
    target.moveTo(points[a].x, points[a].y);
    target.lineTo(points[b].x, points[b].y);
    target.stroke();
  }
  for (const p of points) {
    target.beginPath();
    target.arc(p.x, p.y, preview ? 2 : 3, 0, Math.PI * 2);
    target.fillStyle = preview ? "#eefca7" : "#d9c3ffbb";
    target.fill();
  }
  if (preview) {
    target.beginPath();
    target.arc(points[8].x, points[8].y, 5, 0, Math.PI * 2);
    target.strokeStyle = "#d6fd51";
    target.stroke();
  }
  target.restore();
}
function drawBlade(now) {
  blade.trail = blade.trail.filter((p) => now - p.time < 0.19);
  const trail = blade.trail;
  if (trail.length > 1) {
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowColor = "#d6fd51";
    ctx.shadowBlur = reducedMotion ? 0 : 16;
    for (let i = 1; i < trail.length; i++) {
      const freshness = clamp(1 - (now - trail[i].time) / 0.19, 0, 1);
      ctx.strokeStyle = `rgba(214,253,81,${freshness * 0.8})`;
      ctx.lineWidth = 2 + freshness * 9;
      ctx.beginPath();
      ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
      ctx.lineTo(trail[i].x, trail[i].y);
      ctx.stroke();
      ctx.strokeStyle = `rgba(255,255,240,${freshness})`;
      ctx.lineWidth = 2 + freshness * 2;
      ctx.stroke();
    }
    ctx.restore();
  }
  const tip = control === "hand" ? blade.visualPoint(now) : blade.point;
  if (tip && (control === "pointer" || hasHand)) {
    ctx.save();
    ctx.strokeStyle = "#e0ff70";
    ctx.lineWidth = 2;
    ctx.shadowColor = "#d6fd51";
    ctx.shadowBlur = 13;
    ctx.beginPath();
    ctx.arc(
      tip.x,
      tip.y,
      control === "hand" ? 12 : pointerDown ? 9 : 7,
      0,
      Math.PI * 2,
    );
    ctx.stroke();
    ctx.fillStyle = "#f7ffd9";
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
function render(dt, now) {
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  if (shake > 0) {
    ctx.translate(
      (Math.random() - 0.5) * shake * 25,
      (Math.random() - 0.5) * shake * 25,
    );
    shake = Math.max(0, shake - dt);
  }
  if (phase !== "menu" && phase !== "setup") {
    if (control === "hand") drawSkeleton(ctx, width, height);
    drawFragments(dt);
    engine.entities.filter((f) => !f.sliced).forEach(drawSprite);
    drawParticles(dt);
    for (const p of popups) {
      if (phase !== "paused") {
        p.life -= dt;
        p.y -= dt * (p.large ? 16 : 55);
      }
      ctx.globalAlpha = clamp(p.life / 0.2, 0, 1);
      ctx.textAlign = "center";
      ctx.fillStyle = p.color;
      ctx.font = `800 ${p.large ? clamp(width * 0.042, 23, 39) : 25}px 'Barlow Condensed', Impact, sans-serif`;
      ctx.shadowColor = "#100919";
      ctx.shadowBlur = 10;
      ctx.fillText(p.label, clamp(p.x, 65, width - 65), p.y);
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;
    popups = popups.filter((p) => p.life > 0);
    if (phase === "playing" || phase === "countdown") drawBlade(now);
  }
  ctx.restore();
  if (flash > 0) {
    ctx.fillStyle = `rgba(255,84,115,${flash * 0.65})`;
    ctx.fillRect(0, 0, width, height);
    flash = Math.max(0, flash - dt);
  }
  if (tracker.active) {
    previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    drawSkeleton(previewCtx, previewCanvas.width, previewCanvas.height, true);
  }
}
let lastTick = -1;
function frame(timestamp) {
  const rawDt = Math.max(0, (timestamp - previousTime) / 1000);
  previousTime = timestamp;
  const dt = Math.min(rawDt, 0.1),
    now = timestamp / 1000;
  if (control === "hand" && hasHand && now - lastHandTime > 0.3) {
    hasHand = false;
    landmarks = null;
    clearInput();
  }
  if (phase === "countdown" && !document.hidden && !$("help-dialog").open) {
    if (control === "hand" && !hasHand) {
      countdown = 3;
      lastCountdown = null;
      text("countdown-number", "✋");
      text("countdown-hint", "Raise one hand. Find the glowing fingertip.");
    } else {
      countdown -= dt;
      const count = Math.ceil(countdown);
      if (count !== lastCountdown && count > 0) {
        lastCountdown = count;
        text("countdown-number", count);
        text(
          "countdown-hint",
          control === "hand"
            ? "Keep your hand in view. Get ready to slice."
            : "Hold and drag to slice. Lift to dodge.",
        );
        sound.tone(440, 440, 0.08);
      }
      if (countdown <= 0) {
        lastTick = -1;
        play();
      }
    }
  }
  if (phase === "playing") {
    if (control === "hand" && !hasHand) {
      lostSince ??= now;
      show("hand-notice", now - lostSince > 0.25);
      if (now - lostSince > 1.2) pause("hand");
    } else {
      lostSince = null;
      show("hand-notice", false);
    }
    // A severely stalled frame is paused rather than advancing an unseen round.
    if (rawDt > 0.5) pause("away");
    if (phase === "playing") engine.update(rawDt);
    updateHUD();
    const tick = Math.ceil(engine.remaining);
    if (engine.remaining <= 10 && tick !== lastTick && tick > 0) {
      sound.tone(540, 450, 0.05, 0, "sine", 0.04);
      lastTick = tick;
    }
  }
  text(
    "input-status",
    control === "hand"
      ? hasHand
        ? "✦ HAND TRACKED · SWIPE TO SLICE"
        : "LOOKING FOR YOUR HAND…"
      : "HOLD + DRAG TO SLICE",
  );
  render(dt, now);
  requestAnimationFrame(frame);
}

function resize() {
  const box = arena.getBoundingClientRect();
  width = Math.max(1, arena.clientWidth);
  height = Math.max(1, arena.clientHeight);
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  previewCanvas.width = 296;
  previewCanvas.height = 210;
  engine.resize(width, height);
  clearInput();
  if (phase === "playing" && box.width > 0) pause("resize");
}
new ResizeObserver(resize).observe(arena);
resize();
function pointerPosition(event) {
  const box = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - box.left) * width) / box.width,
    y: ((event.clientY - box.top) * height) / box.height,
  };
}
canvas.addEventListener("pointerdown", (event) => {
  if (
    control !== "pointer" ||
    phase !== "playing" ||
    !event.isPrimary ||
    event.button !== 0
  )
    return;
  event.preventDefault();
  canvas.focus({ preventScroll: true });
  sound.unlock();
  pointerDown = true;
  pointerId = event.pointerId;
  blade.clear();
  canvas.setPointerCapture(event.pointerId);
  blade.move(pointerPosition(event), performance.now() / 1000, {
    width,
    height,
  });
});
canvas.addEventListener("pointermove", (event) => {
  if (
    control !== "pointer" ||
    phase !== "playing" ||
    !event.isPrimary ||
    (pointerDown && event.pointerId !== pointerId)
  )
    return;
  const samples = event.getCoalescedEvents?.();
  for (const sample of samples?.length ? samples : [event]) {
    const segment = blade.move(
      pointerPosition(sample),
      sample.timeStamp / 1000,
      { active: pointerDown, width, height },
    );
    if (segment && pointerDown) engine.slice(...segment);
  }
});
function releasePointer(event) {
  if (event.pointerId === pointerId) {
    pointerDown = false;
    pointerId = null;
    blade.clear();
  }
}
canvas.addEventListener("pointerup", releasePointer);
canvas.addEventListener("pointercancel", releasePointer);
canvas.addEventListener("lostpointercapture", releasePointer);
canvas.addEventListener("pointerleave", () => {
  if (!pointerDown && control === "pointer") blade.clear();
});
canvas.addEventListener("contextmenu", (event) => event.preventDefault());
$("camera-start").addEventListener("click", () => startRound("hand"));
$("pointer-start").addEventListener("click", () => startRound("pointer"));
$("pause-button").addEventListener("click", () => pause());
$("resume-button").addEventListener("click", () => {
  sound.unlock();
  beginCountdown(true);
});
$("play-again").addEventListener("click", () => {
  home();
  startRound(control);
});
$("pause-home").addEventListener("click", home);
$("result-home").addEventListener("click", home);
for (const radio of document.querySelectorAll('input[name="mode"]'))
  radio.addEventListener("change", () => {
    mode = radio.value;
    syncBest();
  });
$("sound-button").addEventListener("click", () => {
  sound.unlock();
  sound.muted = !sound.muted;
  storage.set("slice-club-muted", String(sound.muted));
  updateSoundButton();
});
$("help-button").addEventListener("click", () => {
  if (phase === "playing" || phase === "countdown") pause();
  $("help-dialog").showModal();
});
$("close-help").addEventListener("click", () => $("help-dialog").close());
$("help-dialog").addEventListener("click", (event) => {
  if (event.target === $("help-dialog")) {
    const r = event.target.getBoundingClientRect();
    if (
      event.clientX < r.left ||
      event.clientX > r.right ||
      event.clientY < r.top ||
      event.clientY > r.bottom
    )
      event.target.close();
  }
});
$("fullscreen-button").addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await arena.requestFullscreen();
  } catch {
    text("announcer", "Fullscreen is not supported in this browser window.");
  }
});
if (!document.fullscreenEnabled) $("fullscreen-button").hidden = true;
document.addEventListener("fullscreenchange", () =>
  $("fullscreen-button").setAttribute(
    "aria-label",
    document.fullscreenElement ? "Exit fullscreen" : "Enter fullscreen",
  ),
);
document.addEventListener("keydown", (event) => {
  if ($("help-dialog").open || event.target.matches("input") || event.repeat)
    return;
  if (event.key.toLowerCase() === "m") $("sound-button").click();
  if (
    event.key === "Escape" &&
    (phase === "playing" || phase === "countdown")
  ) {
    event.preventDefault();
    pause();
  }
  if (event.code === "Space" && !event.target.matches("button, a")) {
    if (phase === "playing" || phase === "countdown") {
      event.preventDefault();
      pause();
    } else if (phase === "paused") {
      event.preventDefault();
      beginCountdown(true);
    }
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) pause("away");
});
window.addEventListener("blur", () => {
  pause("away");
  pointerDown = false;
  blade.clear();
});
window.addEventListener("pagehide", () => {
  tracker.stop();
});
requestAnimationFrame(frame);
