/**
 * RoomActor —— 每个游戏房间一个 Virtual Actor（stageName = 房间名）。
 *
 * 展示的 Troupe 特性：
 *   - 严格串行：同房间的 join/move/tick 天然互斥，无需任何锁
 *   - registerCue 内存 Cue：100ms 游戏循环，仅在场运行，空闲下场自动停
 *   - 攒批落盘：tick 热路径零 IO，flush Cue 每 5s saveProps（丢失窗口 RPO = 5s）
 *   - idempotent join：同 playerId 重放不重复进场
 *   - Props 全部是普通对象/数组（Codec 边界禁 Map/Set/Date）
 */
import { Actor, Intermission, Performs } from "troupe";
import {
  ARENA_H,
  ARENA_W,
  COIN_COUNT,
  COIN_VALUE,
  FLUSH_MS,
  MAX_PLAYERS,
  PICKUP_RADIUS,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  TICK_MS,
  type CoinState,
  type RoomSnapshot,
} from "../shared/protocol.js";

interface Player {
  id: string;
  name: string;
  color: string;
  x: number;
  y: number;
  /** 移动方向（-1/0/1），latest-wins */
  dx: number;
  dy: number;
  score: number;
}

interface RoomProps {
  tick: number;
  /** 自增序列：分配玩家颜色与金币 id */
  seq: number;
  players: Record<string, Player>;
  coins: CoinState[];
  /** 攒批落盘标记 */
  dirty: boolean;
}

const COLORS = [
  "#ef4444", "#22c55e", "#3b82f6", "#f97316", "#a855f7", "#14b8a6",
  "#ec4899", "#84cc16", "#f59e0b", "#06b6d4", "#8b5cf6", "#e11d48",
];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

@Performs("Room")
@Intermission("10m")
export class RoomActor extends Actor<RoomProps> {
  static initialProps = (): RoomProps => ({
    tick: 0,
    seq: 1,
    players: {},
    coins: [],
    dirty: false,
  });

  override async onStage() {
    // 首次登台铺满金币；重登台时 coins 随 Props 快照恢复
    while (this.props.coins.length < COIN_COUNT) this.props.coins.push(this._spawnCoin());
    this.registerCue("tick", TICK_MS, () => this._advance());
    this.registerCue("flush", FLUSH_MS, () => this._flush());
  }

  override async offStage() {
    await this._flush(); // 下场前把最后的内存状态交出去
  }

  /** 进房。幂等：同 playerId + 同名重复调用返回同一玩家；同名异 id 视为不同玩家 */
  async join(playerId: string, name: string): Promise<RoomSnapshot> {
    return this.idempotent(`join:${playerId}`, name, async () => {
      if (!this.props.players[playerId]) {
        if (Object.keys(this.props.players).length >= MAX_PLAYERS) {
          throw new Error("房间已满");
        }
        this.props.players[playerId] = {
          id: playerId,
          name,
          color: COLORS[this.props.seq % COLORS.length],
          x: PLAYER_RADIUS + Math.random() * (ARENA_W - PLAYER_RADIUS * 2),
          y: PLAYER_RADIUS + Math.random() * (ARENA_H - PLAYER_RADIUS * 2),
          dx: 0,
          dy: 0,
          score: 0,
        };
        this.props.seq++;
      }
      return this.snapshot();
    });
  }

  /** 移动方向。热路径：只改内存，不落盘（flush 攒批），latest-wins */
  async setDir(playerId: string, dx: number, dy: number): Promise<void> {
    const p = this.props.players[playerId];
    if (!p) return; // 与 leave 的竞态：静默丢弃
    p.dx = clamp(dx, -1, 1);
    p.dy = clamp(dy, -1, 1);
  }

  async leave(playerId: string): Promise<void> {
    if (!this.props.players[playerId]) return;
    delete this.props.players[playerId];
    this.props.dirty = true;
    await this.saveProps();
  }

  /** 全房快照。出参经 Codec 深拷贝，调用方改动不影响 Actor 内部状态 */
  async snapshot(): Promise<RoomSnapshot> {
    return {
      tick: this.props.tick,
      players: Object.values(this.props.players).map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        x: p.x,
        y: p.y,
        score: p.score,
      })),
      coins: this.props.coins.map((c) => ({ ...c })),
    };
  }

  // ---- 以下划线开头的方法不进 RPC 白名单，是 Actor 内部实现 ----

  private _spawnCoin(): CoinState {
    return {
      id: this.props.seq++,
      x: PLAYER_RADIUS + Math.random() * (ARENA_W - PLAYER_RADIUS * 2),
      y: PLAYER_RADIUS + Math.random() * (ARENA_H - PLAYER_RADIUS * 2),
    };
  }

  /** 游戏循环：推进移动与吃币判定，零 IO */
  private _advance(): void {
    this.props.tick++;
    const players = Object.values(this.props.players);
    if (players.length === 0) return;
    const step = (PLAYER_SPEED * TICK_MS) / 1000;
    for (const p of players) {
      if (p.dx === 0 && p.dy === 0) continue;
      const len = Math.hypot(p.dx, p.dy);
      p.x = clamp(p.x + (p.dx / len) * step, PLAYER_RADIUS, ARENA_W - PLAYER_RADIUS);
      p.y = clamp(p.y + (p.dy / len) * step, PLAYER_RADIUS, ARENA_H - PLAYER_RADIUS);
    }
    for (const coin of this.props.coins) {
      const eater = players.find(
        (p) => Math.hypot(p.x - coin.x, p.y - coin.y) < PICKUP_RADIUS,
      );
      if (eater) {
        eater.score += COIN_VALUE;
        Object.assign(coin, this._spawnCoin()); // 原地重生（换 id、换位置）
      }
    }
    this.props.dirty = true;
  }

  /** 攒批落盘：dirty 才写 */
  private async _flush(): Promise<void> {
    if (!this.props.dirty) return;
    await this.saveProps();
    this.props.dirty = false;
  }
}
