/* Coin Rush 浏览器客户端：WebSocket 连接 + Canvas 渲染（零构建单文件）。 */
"use strict";

const TICK_MS = 100;
const PLAYER_R = 14;
const COIN_R = 9;
const NAME_RE = /[^\w\u4e00-\u9fa5-]/g;

const room =
  (new URLSearchParams(location.search).get("room") || "")
    .replace(NAME_RE, "")
    .slice(0, 32) || "lobby";
/** 可用 ?server=host:port 指向任意 Coin Rush 服务器实现；缺省连本页面所在主机 */
const server =
  (new URLSearchParams(location.search).get("server") || "").replace(/[^\w.:\[\]-]/g, "");

const canvas = document.getElementById("arena");
const ctx = canvas.getContext("2d");
const scoresEl = document.getElementById("scores");
const statusEl = document.getElementById("status");
const overlay = document.getElementById("overlay");
const joinErr = document.getElementById("join-err");
const nameInput = document.getElementById("name");

document.getElementById("room-label").textContent = `房间 #${room}`;
document.getElementById("overlay-room").textContent = `房间 #${room}`;

let ws = null;
let playerId = null;
let joined = false;
let name = "";

/** 渲染插值：cur 为最新快照，prev 为上一份，按 tick 进度线性过渡（10Hz 平滑到 60fps） */
let cur = null;
let prev = null;
let curAt = 0;

const keys = new Set();
let lastDir = "";

function wsUrl() {
  const proto = location.protocol === "https:" ? "wss://" : "ws://";
  const host = server || location.host;
  return `${proto}${host}/ws?room=${encodeURIComponent(room)}`;
}

function connect() {
  statusEl.textContent = "连接服务器中…";
  ws = new WebSocket(wsUrl());
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "join", name }));
  };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "hello") {
      playerId = msg.playerId;
      applySnapshot(msg.snapshot);
      if (!joined) {
        joined = true;
        overlay.classList.add("hidden");
      }
      statusEl.textContent = "";
    } else if (msg.type === "state") {
      applySnapshot(msg.snapshot);
    } else if (msg.type === "error") {
      joinErr.textContent = msg.message;
      ws.close();
    }
  };
  ws.onclose = () => {
    ws = null;
    if (!joined) {
      statusEl.textContent = "";
      return;
    }
    statusEl.textContent = "连接断开，3 秒后重连…";
    setTimeout(connect, 3000);
  };
}

function applySnapshot(snap) {
  prev = cur;
  cur = snap;
  curAt = performance.now();
  renderScores(snap);
}

function sendDir(dx, dy) {
  const dir = `${dx},${dy}`;
  if (dir === lastDir) return;
  lastDir = dir;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "move", dx, dy }));
  }
}

function readKeys() {
  const dx =
    (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) -
    (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
  const dy =
    (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0) -
    (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0);
  sendDir(dx, dy);
}

window.addEventListener("keydown", (e) => {
  if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
  if (!joined || keys.has(e.code)) return;
  keys.add(e.code);
  readKeys();
});
window.addEventListener("keyup", (e) => {
  keys.delete(e.code);
  readKeys();
});
window.addEventListener("blur", () => {
  keys.clear();
  sendDir(0, 0);
});

function renderScores(snap) {
  const rows = [...snap.players].sort((a, b) => b.score - a.score);
  scoresEl.innerHTML = "";
  for (const p of rows) {
    const li = document.createElement("li");
    if (p.id === playerId) li.className = "me";
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = p.color;
    const nameEl = document.createElement("span");
    nameEl.className = "name";
    nameEl.textContent = p.name;
    const scoreEl = document.createElement("span");
    scoreEl.className = "score";
    scoreEl.textContent = p.score;
    li.append(dot, nameEl, scoreEl);
    scoresEl.append(li);
  }
}

function draw(now) {
  requestAnimationFrame(draw);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();
  if (!cur) return;
  const alpha = Math.min(1, (now - curAt) / TICK_MS);

  for (const c of cur.coins) {
    ctx.beginPath();
    ctx.arc(c.x, c.y, COIN_R, 0, Math.PI * 2);
    ctx.fillStyle = "#fbbf24";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(c.x - 3, c.y - 3, 3, 0, Math.PI * 2);
    ctx.fillStyle = "#fde68a";
    ctx.fill();
  }

  ctx.textAlign = "center";
  for (const p of cur.players) {
    const o = prev ? prev.players.find((q) => q.id === p.id) : null;
    const x = o ? o.x + (p.x - o.x) * alpha : p.x;
    const y = o ? o.y + (p.y - o.y) * alpha : p.y;

    if (p.id === playerId) {
      ctx.beginPath();
      ctx.arc(x, y, PLAYER_R + 5, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(x, y, PLAYER_R, 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.fill();

    ctx.font = "12px system-ui";
    ctx.fillStyle = "#e2e8f0";
    ctx.fillText(p.name, x, y - PLAYER_R - 8);
    ctx.fillStyle = "#fbbf24";
    ctx.fillText(String(p.score), x, y + PLAYER_R + 16);
  }
}

function drawGrid() {
  ctx.strokeStyle = "rgba(148,163,184,0.08)";
  ctx.lineWidth = 1;
  for (let x = 40; x < canvas.width; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  for (let y = 40; y < canvas.height; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }
}

requestAnimationFrame(draw);

function tryJoin() {
  name = nameInput.value.trim().replace(NAME_RE, "").slice(0, 12);
  if (!name) name = `玩家${Math.floor(Math.random() * 900 + 100)}`;
  joinErr.textContent = "";
  connect();
}

document.getElementById("join").addEventListener("click", tryJoin);
nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") tryJoin();
});
nameInput.focus();
