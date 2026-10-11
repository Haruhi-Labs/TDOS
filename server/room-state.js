// 生命周期写入由房间聚合提交，调用方只负责后续广播和统计消费。
export function beginRoomMatch(room, options) { return room.begin(options); }
export function startRoomRunning(room, now) { return room.startRunning(now); }
export function finishRoomMatch(room, now, delay, buildResult) { return room.finish(now, delay, buildResult); }
