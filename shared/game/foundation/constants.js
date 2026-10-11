// 所有运行模式共享的基础时序与地图常量。
export const DEFAULT_WORLD_SIZE = 1440;
export const DEFAULT_MAP_PADDING = 20;
export const TICK_RATE = 30;

// 网络快照固定每两个权威 tick 下发一次。15Hz 配合客户端插值保持流畅显示，
// 同时控制多人和观战场景下的出口带宽。
export const SNAPSHOT_RATE = 15;
export const TICK_DT = 1 / TICK_RATE;
