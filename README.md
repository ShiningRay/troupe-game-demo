# 🪙 Coin Rush — Troupe.js 多人在线游戏 Demo

基于 [Troupe.js](../troupejs) Virtual Actor 框架的多人在线竞技场小游戏：玩家在 800×600
的竞技场里用键盘移动、抢金币、比排行。每个游戏房间就是一个 Virtual Actor，天然串行、
无锁、可持久化。

## 玩法

- 打开页面，输入昵称进入房间（默认 `?room=lobby`，改 URL 即可开新房间）
- `WASD` / 方向键移动，碰到金币即得分，金币原地重生
- 右侧排行榜按分数实时排序；断线自动重连

## 快速开始

前置：Node ≥ 22.13；本 demo 通过 `file:../troupejs` 引用本地框架，**框架需先构建**：

```bash
cd ../troupejs && npm install && npm run build   # 产出 dist/（只需一次）
cd ../troupe-game-demo && npm install
npm run dev        # 默认 8787 端口，可用 `npm run dev 9000` 换端口
```

打开 <http://localhost:8787/?room=lobby>，多开几个标签页/浏览器就是多人联机。

带框架内省面板启动：`BOOTH=1 npm run dev`，面板在 <http://127.0.0.1:7500>。

```bash
npm test           # vitest：RoomActor 行为测试（NODE_ENV=test 下零配置全内存）
npm run typecheck  # tsc --noEmit
```

## 架构

```
浏览器 Canvas 客户端（public/，零构建单文件）
   │  ws ↑↓ JSON 帧：join / move          ←  每 100ms 状态快照广播
   ▼
src/server.ts（node:http + ws，边缘层）
   │  troupe.cast(RoomActor, roomId).join / setDir / leave / snapshot()
   ▼
RoomActor（每房间一个 Virtual Actor，严格串行 Turn）
   • tick Cue（100ms）: 推进移动、吃币判定、金币重生
   • flush Cue（5s）  : dirty 攒批 saveProps → SQLite（.troupe/，重启不丢分）
```

## Troupe 特性在游戏里的落点

| 游戏需求 | Troupe 机制 |
|---|---|
| 同房间操作互斥（移动/吃币/进出场） | Actor 严格串行执行，零锁 |
| 100ms 游戏循环 | `onStage()` 里 `registerCue("tick", "100ms")`，仅在场运行，房间空闲下场自动停 |
| 高频 tick 不拖垮 IO | 热路径只改内存，flush Cue 攒批 `saveProps`（丢失窗口 RPO = 5s） |
| 进房防重放 | `this.idempotent("join:" + playerId, name, fn)` |
| 跨调用数据边界 | Props/参数/返回值全部普通对象与数组（Codec 禁 `Map`/`Set`/`Date`），出参深拷贝 |
| 多房间水平扩展 | 一个 `?room=xxx` = 一个 `(Room, 房间名)` Actor，按需登台、互不干扰 |
| 运维可观测 | `BOOTH=1` 开 Booth 内省面板；`troupe.director()` CLI |
| 优雅停机 | `SIGINT` → `troupe.shutdown()`（flush 全部在场房间后退出） |

广播模式与官方 `examples/chat` 一致：边缘层自持 `Map<room, Set<WebSocket>>`，
100ms 定时调 `snapshot()` 把 JSON 帧推给同房间所有连接；最后一个连接离开即停循环，
房间空闲到 `@Intermission("10m")` 自动下场、tick 随之停止。

## 工程结构

```
src/
  shared/protocol.ts    # 常量与消息协议（客户端/服务端共享）
  actors/room-actor.ts  # RoomActor：游戏状态 + tick/flush Cue + 幂等 join
  server.ts             # http 静态文件 + ws 长连接 + 房间广播循环
public/
  index.html            # Canvas 客户端（零构建）
  client.js             # 连接管理、键盘输入、快照插值渲染、排行榜
test/
  room-actor.test.ts    # 串行性 / 幂等 / 吃币计分 / 快照隔离 / 房间隔离
```

## 已知边界（demo 有意从简）

- 服务器硬杀（无 SIGINT）时最多丢最近 5s 的分数（RPO = flush 周期）；客户端断线由
  ws close 驱动 `leave`，非正常断开（如服务器崩溃）可能留下"幽灵玩家"，重开即清。
- 广播轮询与游戏 tick 都在单进程内；多节点部署需按框架文档启用
  `cluster` + `ownership`（共享 PostgresPropStore），房间 Actor 会被 HashRing 自动分片。
- 客户端只做了 100ms 快照线性插值，无客户端预测；手感要求高可加 dead reckoning。

## 框架注意点（踩过的坑）

- `troupe` 是 `file:` 链接依赖：改了 `../troupejs/src` 记得重新 `npm run build`。
- 框架装饰器是 TS5 stage-3 签名；2026-09 起 `@Performs`/`@Intermission` 已收紧为返回
  `void`，对带 static 成员的类在 strict 下不再报 TS1270（见 troupejs `src/core/meta.ts`）。
