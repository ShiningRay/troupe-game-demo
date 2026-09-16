/**
 * Coin Rush 服务器：
 *   - node:http：serve public/ 静态文件
 *   - ws：WebSocket 长连接（客户端指令 → Actor 调用）
 *   - Troupe：URL ?room=xxx 对应一个 RoomActor（虚拟 Actor，按需登台）
 *
 * 广播模式（与官方 examples/chat 一致，长连接用 WS 替代 SSE）：
 *   每个有人的房间一个 100ms 广播循环 → cast(RoomActor, room).snapshot()
 *   → JSON 帧推给该房间所有连接；最后一人离开即停循环，房间空闲自动下场。
 *
 * 运行：npm run dev [端口]（默认 8787）；BOOTH=1 额外开框架内省面板 :7500
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { Troupe } from "troupe";
import { RoomActor } from "./actors/room-actor.js";
import { TICK_MS, type C2SMessage, type S2CMessage } from "./shared/protocol.js";

const PORT = Number(process.argv[2] ?? process.env.PORT ?? 8787);
const PUBLIC_DIR = fileURLToPath(new URL("../public", import.meta.url));

const troupe = await Troupe.form({
  actors: [RoomActor],
  booth: process.env.BOOTH ? { port: 7500 } : undefined,
});

interface Conn {
  ws: WebSocket;
  room: string;
  playerId: string | null;
}

/** 边缘层注册表：房间 → 在线连接（广播目标） */
const rooms = new Map<string, Set<Conn>>();
const broadcasters = new Map<string, NodeJS.Timeout>();

function sanitize(value: string | null, fallback: string): string {
  // 允许字母数字、下划线、连字符、中文
  return (value ?? "").replace(/[^\w\u4e00-\u9fa5-]/g, "").slice(0, 32) || fallback;
}

function send(ws: WebSocket, msg: S2CMessage): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

/** 房间第一个连接出现时启动 100ms 快照广播循环 */
function ensureBroadcaster(room: string): void {
  if (broadcasters.has(room)) return;
  const agent = troupe.cast(RoomActor, room);
  const timer = setInterval(() => {
    void (async () => {
      const conns = rooms.get(room);
      if (!conns || conns.size === 0) return;
      let payload: string;
      try {
        const snapshot = await agent.snapshot();
        payload = JSON.stringify({ type: "state", snapshot } satisfies S2CMessage);
      } catch {
        return; // 房间暂不可用（激活失败等）：下一拍重试
      }
      for (const conn of conns) {
        if (conn.ws.readyState === WebSocket.OPEN) conn.ws.send(payload);
      }
    })();
  }, TICK_MS);
  broadcasters.set(room, timer);
}

/** 房间无人时停掉广播循环——没有调用了，Actor 空闲到点自动下场、tick 随之停 */
function stopBroadcasterIfEmpty(room: string): void {
  const conns = rooms.get(room);
  if (conns && conns.size > 0) return;
  rooms.delete(room);
  const timer = broadcasters.get(room);
  if (timer) {
    clearInterval(timer);
    broadcasters.delete(room);
  }
}

async function handleMessage(conn: Conn, msg: C2SMessage): Promise<void> {
  const agent = troupe.cast(RoomActor, conn.room);
  if (msg.type === "join") {
    const name = sanitize(String(msg.name ?? ""), "玩家").slice(0, 12);
    if (!conn.playerId) conn.playerId = randomUUID();
    const snapshot = await agent.join(conn.playerId, name);
    let conns = rooms.get(conn.room);
    if (!conns) {
      conns = new Set();
      rooms.set(conn.room, conns);
    }
    conns.add(conn);
    send(conn.ws, { type: "hello", playerId: conn.playerId, snapshot });
    ensureBroadcaster(conn.room);
  } else if (msg.type === "move" && conn.playerId) {
    await agent.setDir(conn.playerId, Number(msg.dx) || 0, Number(msg.dy) || 0);
  }
}

// ---- HTTP：静态文件 ----

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

const httpServer = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const file = normalize(url.pathname === "/" ? "index.html" : url.pathname.slice(1));
    if (file.startsWith("..")) throw new Error("forbidden");
    const body = await readFile(join(PUBLIC_DIR, file));
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not Found");
  }
});

// ---- WebSocket：客户端长连接 ----

const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (ws, req) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const conn: Conn = { ws, room: sanitize(url.searchParams.get("room"), "lobby"), playerId: null };

  ws.on("message", (data) => {
    let msg: C2SMessage;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }
    handleMessage(conn, msg).catch((err: unknown) => {
      send(ws, { type: "error", message: err instanceof Error ? err.message : String(err) });
    });
  });

  ws.on("close", () => {
    const conns = rooms.get(conn.room);
    if (conns) {
      conns.delete(conn);
      stopBroadcasterIfEmpty(conn.room);
    }
    if (conn.playerId) {
      troupe.cast(RoomActor, conn.room).leave(conn.playerId).catch(() => {});
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`🪙 Coin Rush 已启动:  http://localhost:${PORT}/?room=lobby`);
  console.log(`   多房间:            http://localhost:${PORT}/?room=room2（每个房间 = 一个 RoomActor）`);
  if (process.env.BOOTH) console.log("   Troupe 内省面板:   http://127.0.0.1:7500");
});

process.on("SIGINT", async () => {
  console.log("\n正在优雅停机（flush 房间状态）...");
  wss.close();
  httpServer.close();
  await troupe.shutdown();
  process.exit(0);
});
