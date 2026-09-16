/**
 * 客户端与服务端共享的游戏常量与消息协议。
 * 注意：所有跨 Actor 调用边界/WS 边界的数据都是普通对象/数组（Codec 禁 Map/Set/Date）。
 */

export const ARENA_W = 800;
export const ARENA_H = 600;
/** 游戏循环周期（毫秒），也是快照广播周期 */
export const TICK_MS = 100;
/** 玩家速度（逻辑单位/秒） */
export const PLAYER_SPEED = 240;
export const PLAYER_RADIUS = 14;
export const COIN_COUNT = 8;
export const COIN_RADIUS = 9;
export const COIN_VALUE = 1;
export const PICKUP_RADIUS = PLAYER_RADIUS + COIN_RADIUS;
export const MAX_PLAYERS = 16;
/** 攒批落盘周期：RPO = 5s */
export const FLUSH_MS = 5000;

export interface PlayerState {
  id: string;
  name: string;
  color: string;
  x: number;
  y: number;
  score: number;
}

export interface CoinState {
  id: number;
  x: number;
  y: number;
}

export interface RoomSnapshot {
  tick: number;
  players: PlayerState[];
  coins: CoinState[];
}

/** client → server */
export type C2SMessage =
  | { type: "join"; name: string }
  | { type: "move"; dx: number; dy: number };

/** server → client */
export type S2CMessage =
  | { type: "hello"; playerId: string; snapshot: RoomSnapshot }
  | { type: "state"; snapshot: RoomSnapshot }
  | { type: "error"; message: string };
