/**
 * RoomActor 行为测试。
 * vitest 运行时 NODE_ENV=test → Troupe.form 零配置全内存（无 SQLite 落盘）。
 * RoomActor 声明 @Intermission("10m")，测试期间保持在场，100ms tick Cue 走真实定时器。
 */
import { afterEach, describe, expect, it } from "vitest";
import { IdempotencyConflictError, Troupe } from "troupe";
import { RoomActor } from "../src/actors/room-actor.js";
import { COIN_COUNT, TICK_MS } from "../src/shared/protocol.js";

let troupe: Troupe | undefined;

afterEach(async () => {
  if (troupe) {
    await troupe.drainAll();
    await troupe.shutdown();
    troupe = undefined;
  }
});

async function formRoom(stageName: string) {
  troupe = await Troupe.form({ actors: [RoomActor] });
  return troupe.cast(RoomActor, stageName);
}

describe("RoomActor", () => {
  it("并发 join 严格串行，全部生效且无锁竞争", async () => {
    const room = await formRoom("t-concurrent");
    const ids = Array.from({ length: 10 }, (_, i) => `p${i}`);
    await Promise.all(ids.map((id) => room.join(id, `玩家-${id}`)));

    const snap = await room.snapshot();
    expect(snap.players).toHaveLength(10);
    expect(new Set(snap.players.map((p) => p.color)).size).toBe(10); // 颜色分配无重复竞态
  });

  it("join 幂等：同 id 同名重放不重复进场，同 id 异名冲突", async () => {
    const room = await formRoom("t-idem");

    const first = await room.join("p1", "小明");
    const replay = await room.join("p1", "小明");
    expect(replay.players.find((p) => p.id === "p1")!.name).toBe("小明");
    expect(first.players).toHaveLength(1);

    await expect(room.join("p1", "小红")).rejects.toBeInstanceOf(IdempotencyConflictError);
    expect((await room.snapshot()).players).toHaveLength(1);
  });

  it("setDir + tick：玩家朝金币移动会被吃币计分，金币原地重生", async () => {
    const room = await formRoom("t-pickup");
    await room.join("p1", "贪吃蛇");
    const coinIdsBefore = new Set((await room.snapshot()).coins.map((c) => c.id));

    // 追踪 coins[0]：每拍修正朝向，直到吃到（分数 > 0）
    const deadline = Date.now() + 15_000;
    let scored = false;
    while (Date.now() < deadline) {
      const snap = await room.snapshot();
      const me = snap.players.find((p) => p.id === "p1")!;
      if (me.score > 0) {
        scored = true;
        break;
      }
      const coin = snap.coins[0];
      const vx = coin.x - me.x;
      const vy = coin.y - me.y;
      const len = Math.hypot(vx, vy) || 1;
      await room.setDir("p1", vx / len, vy / len);
      await new Promise((r) => setTimeout(r, TICK_MS));
    }
    expect(scored).toBe(true);

    const snap = await room.snapshot();
    expect(snap.coins).toHaveLength(COIN_COUNT); // 数量守恒
    expect(snap.coins.some((c) => !coinIdsBefore.has(c.id))).toBe(true); // 有金币换了 id（重生）
  }, 20_000);

  it("leave 移除玩家；leave 不存在的 id 是无害 no-op", async () => {
    const room = await formRoom("t-leave");
    await room.join("p1", "过客");
    await room.leave("p1");
    expect((await room.snapshot()).players).toHaveLength(0);
    await expect(room.leave("nobody")).resolves.toBeUndefined();
  });

  it("快照是 Codec 深拷贝：改动出参不影响 Actor 内部状态", async () => {
    const room = await formRoom("t-copy");
    await room.join("p1", "原始");

    const s1 = await room.snapshot();
    s1.players[0]!.score = 999;
    (s1.players as unknown[]).length = 0;

    const s2 = await room.snapshot();
    expect(s2.players[0]!.score).toBe(0);
    expect(s2.players).toHaveLength(1);
  });

  it("房间隔离：两个 stageName 是两个独立 Actor 实例", async () => {
    troupe = await Troupe.form({ actors: [RoomActor] });
    const a = troupe.cast(RoomActor, "room-a");
    const b = troupe.cast(RoomActor, "room-b");

    await a.join("p1", "甲");
    await b.join("p2", "乙");

    expect((await a.snapshot()).players.map((p) => p.id)).toEqual(["p1"]);
    expect((await b.snapshot()).players.map((p) => p.id)).toEqual(["p2"]);
  });
});
