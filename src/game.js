const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const hud = document.getElementById("hud");

const ZONE = { x: 170, y: 250, w: 140, h: 170 };
const MAX_OUTS = 3;

let state;

function reset() {
  state = { phase: "aimX", t: 0, aimX: 0, aimY: 0, ball: null, strikes: 0, balls: 0, outs: 0, score: 0, msg: "" };
}

// 0..1 を往復する値
const pingpong = (t, speed) => Math.abs(((t * speed) % 2) - 1);

function pitch() {
  const sx = ZONE.x - 60 + state.aimX * (ZONE.w + 120);
  const sy = ZONE.y - 50 + state.aimY * (ZONE.h + 100);
  state.ball = { p: 0, tx: sx, ty: sy };
  state.phase = "pitch";
}

function resolve() {
  const { tx, ty } = state.ball;
  const inZone = tx > ZONE.x && tx < ZONE.x + ZONE.w && ty > ZONE.y && ty < ZONE.y + ZONE.h;
  const dist = Math.hypot(tx - (ZONE.x + ZONE.w / 2), ty - (ZONE.y + ZONE.h / 2));
  // 真ん中ほど打たれやすい。ボール球は振らないことが多い
  const swing = inZone ? Math.random() < 0.8 : Math.random() < 0.25;
  const hit = swing && Math.random() < Math.max(0.05, 0.75 - dist / 150);
  if (hit) {
    state.msg = "打たれた…ヒット！";
    state.strikes = state.balls = 0;
    state.score -= 1;
  } else if (swing || inZone) {
    state.strikes++;
    state.msg = swing ? "空振り！ストライク" : "見逃し！ストライク";
  } else {
    state.balls++;
    state.msg = "ボール";
  }
  if (state.strikes >= 3) { state.outs++; state.score += 10; state.msg = "三振！"; state.strikes = state.balls = 0; }
  if (state.balls >= 4) { state.msg = "フォアボール"; state.score -= 2; state.strikes = state.balls = 0; }
  state.phase = state.outs >= MAX_OUTS ? "over" : "result";
  state.resultAt = performance.now();
}

function action() {
  if (state.phase === "aimX") { state.aimX = pingpong(state.t, 1.2); state.phase = "aimY"; state.t = 0; }
  else if (state.phase === "aimY") { state.aimY = pingpong(state.t, 1.5); pitch(); }
  else if (state.phase === "result") { state.phase = "aimX"; state.t = 0; state.msg = ""; }
  else if (state.phase === "over") reset();
}

canvas.addEventListener("pointerdown", action);
addEventListener("keydown", e => { if (e.code === "Space") { e.preventDefault(); action(); } });

let last = performance.now();
function frame(now) {
  const dt = (now - last) / 1000; last = now;
  update(dt); draw(); requestAnimationFrame(frame);
}

function update(dt) {
  if (state.phase === "aimX" || state.phase === "aimY") state.t += dt;
  if (state.phase === "pitch") {
    state.ball.p += dt * 1.6;
    if (state.ball.p >= 1) resolve();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "#fff"; ctx.lineWidth = 3;
  ctx.strokeRect(ZONE.x, ZONE.y, ZONE.w, ZONE.h);

  if (state.phase === "aimX") bar(pingpong(state.t, 1.2), true);
  if (state.phase === "aimY") { bar(state.aimX, true); bar(pingpong(state.t, 1.5), false); }

  // ボール
  let bx = 240, by = 500, r = 6;
  if (state.ball && state.phase !== "aimX" && state.phase !== "aimY") {
    const p = state.ball.p;
    bx = 240 + (state.ball.tx - 240) * p;
    by = 500 + (state.ball.ty - 500) * p;
    r = 6 + 4 * p;
  }
  ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(bx, by, r, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = "#fff"; ctx.font = "bold 28px sans-serif"; ctx.textAlign = "center";
  if (state.msg) ctx.fillText(state.msg, 240, 120);
  if (state.phase === "over") {
    ctx.fillText("ゲーム終了  スコア: " + state.score, 240, 170);
    ctx.font = "18px sans-serif"; ctx.fillText("クリックでもう一度", 240, 200);
  }
  hud.textContent = `S:${state.strikes}  B:${state.balls}  アウト:${state.outs}/${MAX_OUTS}  スコア:${state.score}`;
}

// 狙いバー（横は上、縦は右側）
function bar(v, horizontal) {
  ctx.fillStyle = "rgba(255,255,255,.3)";
  ctx.fillStyle = "#ffeb3b";
  if (horizontal) {
    ctx.fillRect(ZONE.x - 60, 215, ZONE.w + 120, 4);
    ctx.fillRect(ZONE.x - 60 + v * (ZONE.w + 120) - 3, 205, 6, 24);
  } else {
    ctx.fillRect(ZONE.x + ZONE.w + 70, ZONE.y - 50, 4, ZONE.h + 100);
    ctx.fillRect(ZONE.x + ZONE.w + 60, ZONE.y - 50 + v * (ZONE.h + 100) - 3, 24, 6);
  }
}

reset();
requestAnimationFrame(frame);
