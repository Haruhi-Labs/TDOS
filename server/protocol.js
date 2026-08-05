export const CONTROL_MESSAGE_TYPES = new Set([
  "set_name",
  "set_loadout",
  "list_rooms",
  "create_room",
  "join_room",
  "spectate_room",
  "join_private",
  "leave_room",
]);

export const RULESET_GUARDED_MESSAGE_TYPES = new Set([
  "create_room",
  "join_room",
  "spectate_room",
  "join_private",
  "select_ship",
  "input",
]);

const MESSAGE_CODES = {
  "房间已关闭": "room_closed",
  "对手离开房间": "opponent_left",
  "对手断开连接，房间已解散": "opponent_disconnected",
  "对局结束，已返回大厅": "match_ended_draw",
  "你已经在房间中": "already_in_room",
  "房间不存在": "room_not_found",
  "该房间不接受玩家加入": "room_not_joinable",
  "该房间不接受观战": "room_not_spectatable",
  "房间不在等待状态": "room_not_waiting",
  "房间不在对战状态": "room_not_running",
  "房间已满或不可加入": "room_full",
  "消息格式错误": "invalid_message_format",
  "未知消息类型": "unknown_message_type",
  "服务器连接数已满": "server_connection_limit",
  "服务器房间数已满": "server_room_limit",
  "服务器活跃对局已满": "server_active_room_limit",
  "服务器实时流容量已满": "server_stream_capacity_limit",
  "该房间观战人数已满": "room_spectator_limit",
};

export function messageCode(message, fallback = "unknown") {
  const raw = String(message || "");
  if (MESSAGE_CODES[raw]) return MESSAGE_CODES[raw];
  if (raw.includes("左翼舰队获胜")) return "match_ended_left_win";
  if (raw.includes("右翼舰队获胜")) return "match_ended_right_win";
  return fallback;
}
