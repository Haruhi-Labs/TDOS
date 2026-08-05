import { CHARACTER_DEFS, DEFAULT_TEAM_LOADOUT, normalizeLoadout } from "../../shared/game-core.js";
import {
  characterShortName,
  fleetSideLabel,
  slotLabel as localizedSlotLabel,
  t,
  translateServerText,
} from "../i18n.js";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character]);
}

function localizedServerName(name, isBot = false) {
  const raw = String(name || "").trim();
  if (!raw || isBot || raw === "空位" || raw === "统合思念体AI") {
    return translateServerText(raw || "空位");
  }
  return raw;
}

function resultPlayerId(row) {
  if (!row) return "-";
  if (row.isBot) return "AI";
  const raw = String(row.playerId || "").trim();
  return raw ? raw.slice(0, 8) : "-";
}

function resultSideHtml(loadout, faction, sideLabel, sideClass, sideId = "") {
  const base = import.meta.env.BASE_URL;
  const safe = normalizeLoadout(loadout, DEFAULT_TEAM_LOADOUT);
  const cards = ["main", "sub1", "sub2"]
    .map((slot, index) => {
      const characterId = safe[slot];
      const source = `${base}assets/portraits/${faction}/${characterId}.webp`;
      const role = localizedSlotLabel(slot, "short");
      const name = characterShortName(
        characterId,
        CHARACTER_DEFS[characterId] ? CHARACTER_DEFS[characterId].shortName : characterId,
      );
      return (
        `<div class="rl-card${slot === "main" ? " rl-main" : ""}" style="--i:${index}">` +
        `<span class="rl-portrait"><img src="${source}" alt="" loading="lazy" draggable="false"></span>` +
        `<span class="rl-role">${escapeHtml(role)}</span>` +
        `<span class="rl-name">${escapeHtml(name)}</span>` +
        `</div>`
      );
    })
    .join("");
  return (
    `<div class="result-side ${sideClass}">` +
    `<div class="result-side-label">${escapeHtml(sideLabel)}</div>` +
    `<div class="result-side-id">${t("ID：{id}", { id: escapeHtml(sideId || "-") })}</div>` +
    `<div class="rl-cards">${cards}</div>` +
    `</div>`
  );
}

export function createOnlineResultView({ app, ui, log }) {
  function close() {
    ui.overlay.classList.add("hidden");
    ui.overlayTitle.textContent = "";
    app.gameOverLogged = false;
  }

  function show(winnerSeat) {
    app.lastWinnerSeat = winnerSeat || null;
    ui.overlay.classList.remove("hidden");
    if (app.gameOverLogged) return;
    app.gameOverLogged = true;

    const card = document.getElementById("resultCard");
    const eyebrowElement = document.getElementById("resultEyebrow");
    const subElement = document.getElementById("resultSub");
    const metaElement = document.getElementById("resultDiff");
    const versusElement = document.getElementById("resultVersus");

    let className;
    let eyebrow;
    let title;
    let subtitle;
    let logLine;
    if (app.spectating) {
      const winnerName = winnerSeat ? fleetSideLabel(winnerSeat) : "";
      className = "result-draw";
      eyebrow = "SPECTATE";
      title = winnerName ? t("{seat}获胜", { seat: winnerName }) : t("战斗结束");
      subtitle = t("观战结束");
      logLine = winnerName ? t("战斗结束：{seat}获胜", { seat: winnerName }) : t("战斗结束：平局");
    } else if (winnerSeat && winnerSeat === app.seat) {
      className = "result-win";
      eyebrow = "VICTORY";
      title = t("胜利");
      subtitle = t("敌方舰队已被击溃");
      logLine = t("战斗结束：我方舰队获胜");
    } else if (winnerSeat) {
      className = "result-lose";
      eyebrow = "DEFEAT";
      title = t("失败");
      subtitle = t("我方舰队被歼灭");
      logLine = t("战斗结束：我方舰队战败");
    } else {
      className = "result-draw";
      eyebrow = "STALEMATE";
      title = t("战斗结束");
      subtitle = t("双方同归于尽");
      logLine = t("战斗结束：平局");
    }

    if (card) {
      card.classList.remove("result-win", "result-lose", "result-draw");
      card.classList.add(className);
    }
    if (eyebrowElement) eyebrowElement.textContent = eyebrow;
    ui.overlayTitle.textContent = title;
    if (subElement) subElement.textContent = subtitle;
    if (metaElement) {
      const roomId = app.room ? app.room.roomId : "-";
      const winnerText = winnerSeat ? fleetSideLabel(winnerSeat) : t("平局");
      metaElement.innerHTML =
        `<span class="result-diff-label">${t("房间ID")}</span>` +
        `<span class="result-diff-val rd-normal">${escapeHtml(roomId)}</span>` +
        `<span class="result-diff-label">${t("胜利方")}</span>` +
        `<span class="result-diff-val ${winnerSeat ? "rd-normal" : "rd-hard"}">${escapeHtml(winnerText)}</span>`;
    }

    if (versusElement) {
      const players = (app.room && app.room.players) || [];
      const rowA = players.find((player) => player.seat === "A");
      const rowB = players.find((player) => player.seat === "B");
      const loadoutA = (rowA && rowA.loadout) || app.playerLoadout;
      const loadoutB = rowB && rowB.loadout;
      const nameA = (rowA && localizedServerName(rowA.name, rowA.isBot)) || fleetSideLabel("A");
      const nameB = (rowB && localizedServerName(rowB.name, rowB.isBot)) || fleetSideLabel("B");
      versusElement.innerHTML =
        resultSideHtml(loadoutA, "blue", nameA, "result-side-player", resultPlayerId(rowA)) +
        `<div class="result-vs"><span>VS</span></div>` +
        resultSideHtml(loadoutB, "red", nameB, "result-side-enemy", resultPlayerId(rowB));
    }

    if (card) {
      card.classList.remove("result-in");
      void card.offsetWidth;
      card.classList.add("result-in");
    }
    log(logLine);
  }

  return { close, show };
}
