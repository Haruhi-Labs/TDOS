import { CHARACTER_DEFS } from "../../shared/game-core.js";
import { t, translateServerText } from "../i18n.js";

function localizedServerName(name, isBot = false) {
  const raw = String(name || "").trim();
  if (!raw || isBot || raw === "空位" || raw === "统合思念体AI") {
    return translateServerText(raw || "空位");
  }
  return raw;
}

function roomStatusText(status) {
  if (status === "waiting") return t("等待玩家");
  if (status === "running") return t("对战中");
  if (status === "countdown") return t("即将开战");
  if (status === "finished") return t("已结束");
  return t("未知");
}

export function createOnlineLobbyView({ app, ui, socketSend, syncLoadoutToServer }) {
  function updateRoomSummary() {
    if (!app.room) {
      ui.roomSummary.textContent = t("未进入房间");
      ui.leaveRoomBtn.disabled = true;
      return;
    }

    const rows = [];
    rows.push(t("房间ID：{id}", { id: app.room.roomId }));
    rows.push(t("类型：{type}", { type: app.room.mode === "ai" ? t("AI 训练") : t("玩家对战") }));
    rows.push(t("可见性：{visibility}", { visibility: app.room.visibility === "private" ? t("私人") : t("公开") }));
    if (app.room.visibility === "private" && app.room.code) {
      rows.push(t("房间号：{code}", { code: app.room.code }));
    }
    rows.push(t("状态：{status}", { status: roomStatusText(app.room.status) }));
    if (Number(app.room.spectatorCount) > 0 || app.spectating) {
      rows.push(t("观战：{count}", { count: Number(app.room.spectatorCount) || 0 }));
    }
    for (const playerRow of app.room.players || []) {
      const seatText = playerRow.seat === "A" ? t("A位") : t("B位");
      const suffix = playerRow.isBot ? t("（AI）") : "";
      const displayName = localizedServerName(playerRow.name, playerRow.isBot);
      const loadoutText = playerRow.loadout
        ? ` | ${CHARACTER_DEFS[playerRow.loadout.main].shortName}/${CHARACTER_DEFS[playerRow.loadout.sub1].shortName}/${CHARACTER_DEFS[playerRow.loadout.sub2].shortName}`
        : "";
      rows.push(t("{seat}：{name}{suffix}{loadout}", {
        seat: seatText,
        name: displayName,
        suffix,
        loadout: loadoutText,
      }));
    }

    ui.roomSummary.textContent = rows.join("\n");
    ui.leaveRoomBtn.disabled = false;
  }

  function renderRooms(rooms) {
    ui.roomList.innerHTML = "";
    if (!rooms || rooms.length === 0) {
      const empty = document.createElement("div");
      empty.className = "room-item room-item-empty";
      empty.textContent = t("当前没有公开房，可先创建一个。");
      ui.roomList.append(empty);
      return;
    }

    for (const room of rooms) {
      const item = document.createElement("div");
      item.className = "room-item";

      const title = document.createElement("div");
      title.className = "room-item-title";
      title.textContent = `${room.mode === "ai" ? t("AI房") : t("玩家对战房")} · ${room.roomId}`;

      const meta = document.createElement("div");
      meta.className = "room-item-meta";
      meta.textContent =
        t("房主：{host} | 人数：{count}/{capacity} | 状态：{status}", {
          host: room.hostName === "未知" ? t("未知") : room.hostName,
          count: room.count,
          capacity: room.capacity,
          status: roomStatusText(room.status),
        }) + ` | ${t("观战：{count}", { count: Number(room.spectatorCount) || 0 })}`;

      const joinButton = document.createElement("button");
      joinButton.textContent = t("加入");
      joinButton.disabled = !app.connected || !app.rulesetCompatible || Boolean(app.room) || room.status !== "waiting" || room.count >= room.capacity;
      joinButton.addEventListener("click", () => {
        syncLoadoutToServer(false);
        socketSend({ type: "join_room", roomId: room.roomId });
      });

      const spectateButton = document.createElement("button");
      spectateButton.textContent = t("观战");
      spectateButton.disabled = !app.connected || !app.rulesetCompatible || Boolean(app.room) || room.status !== "running";
      spectateButton.addEventListener("click", () => {
        socketSend({ type: "spectate_room", roomId: room.roomId });
      });

      const actions = document.createElement("div");
      actions.className = "room-item-actions";
      actions.append(joinButton, spectateButton);
      item.append(title, meta, actions);
      ui.roomList.append(item);
    }
  }

  return { renderRooms, updateRoomSummary };
}
