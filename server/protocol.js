export const CONTROL_MESSAGE_TYPES = new Set([
  "authenticate",
  "set_name",
  "set_loadout",
  "list_rooms",
  "create_room",
  "set_side",
  "set_ready",
  "start_match",
  "join_room",
  "spectate_room",
  "join_private",
  "leave_room",
  "set_statistics_profile",
  "get_winrate_stats",
  "report_solo_match",
]);

export const RULESET_GUARDED_MESSAGE_TYPES = new Set([
  "create_room",
  "set_side",
  "set_ready",
  "start_match",
  "join_room",
  "spectate_room",
  "join_private",
  "select_ship",
  "input",
  "report_solo_match",
]);

const MESSAGE_CODES = {
  "兔女郎春日阵容需要所有玩家及观众刷新到当前规则版本": "bunny_ruleset_required",
  "客户端不支持比赛房间，请刷新页面": "tournament_client_unsupported",
  "不支持的房间玩法格式": "unsupported_room_format",
  "该玩法格式暂不支持AI对战": "format_ai_unsupported",
  "客户端不支持该多人玩法格式，请刷新页面": "multi_fleet_client_unsupported",
  "多人玩法格式需要声明当前规则版本": "multi_fleet_ruleset_required",
  "无效的阵营选择": "invalid_side",
  "目标阵营已满": "side_full",
  "当前玩法格式不支持切换阵营": "side_switch_unsupported",
  "只有已入座玩家可以切换阵营": "side_switch_player_only",
  "对局开始后不能切换阵营": "side_switch_locked",
  "主持人离开，比赛房间已关闭": "tournament_host_left",
  "比赛开始后不能更换阵容": "tournament_loadout_locked",
  "对局开始后不能更换阵容": "loadout_locked",
  "只有比赛选手可以设置就绪": "tournament_player_only",
  "只有已入座玩家可以设置就绪": "ready_player_only",
  "就绪状态无效": "invalid_ready_state",
  "只有主持人可以开始比赛": "tournament_host_only",
  "只有房主可以开始对局": "room_owner_only",
  "双方选手就绪后才能开始比赛": "tournament_not_ready",
  "参战人数不足，无法开始对局": "insufficient_players",
  "双方阵营人数不满足开局要求": "unbalanced_sides",
  "所有参战玩家就绪后才能开始对局": "players_not_ready",
  "有玩家离开房间，倒计时已取消": "player_left",
  "有玩家断开连接，倒计时已取消": "player_disconnected",
  "所有参战玩家已离线，房间已关闭": "all_players_left",
  "无法恢复或接管已离线的席位": "seat_reclaim_unsupported",

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
