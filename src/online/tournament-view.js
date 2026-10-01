import { t } from "../i18n.js";
import "./tournament.css";

// 比赛准备台只消费权威房间状态，不模拟战场，也不在客户端决定开赛。
export function createTournamentView(battleView, { onLoadout, onReady, onStart }) {
  const events = new AbortController();
  battleView.querySelector(".game-wrap").insertAdjacentHTML("beforeend", `<section class="tournament-preparation" aria-label="${t("比赛准备")}" hidden>
    <p class="tournament-host"></p><h2 class="tournament-status" role="status" aria-live="polite"></h2>
    <div class="tournament-player-actions" hidden><button type="button" data-tournament="loadout">${t("更换阵容")}</button><button type="button" data-tournament="ready">${t("设为就绪")}</button></div>
    <button type="button" data-tournament="start" hidden>${t("开始比赛")}</button>
    <p class="tournament-hint">${t("主持人开赛后，3秒倒计时进入战斗")}</p>
  </section>`);
  const panel = battleView.querySelector(".tournament-preparation");
  const readyButton = panel.querySelector('[data-tournament="ready"]');
  const loadoutButton = panel.querySelector('[data-tournament="loadout"]');
  const startButton = panel.querySelector('[data-tournament="start"]');
  let ready = false;
  loadoutButton.addEventListener("click", onLoadout, { signal: events.signal });
  readyButton.addEventListener("click", () => onReady(!ready), { signal: events.signal });
  startButton.addEventListener("click", onStart, { signal: events.signal });

  function update({ room, seat, isHost, connected, compatible }) {
    const preparing = room?.kind === "tournament" && room.status === "waiting";
    battleView.classList.toggle("tournament-waiting", preparing);
    panel.hidden = !preparing;
    if (!preparing) return;
    const contestants = (room.players || []).filter((player) => player.playerId);
    const allReady = contestants.length === 2 && contestants.every((player) => player.ready);
    ready = Boolean(contestants.find((player) => player.seat === seat)?.ready);
    panel.querySelector(".tournament-host").textContent = t("主持：{name}", { name: room.hostName || "—" });
    const status = contestants.length < 2 ? t("等待选手加入") : allReady ? t("等待主持人开赛") : t("选手准备中");
    const statusNode = panel.querySelector(".tournament-status");
    if (statusNode.textContent !== status) statusNode.textContent = status;
    panel.querySelector(".tournament-player-actions").hidden = !seat;
    readyButton.textContent = ready ? t("取消就绪") : t("设为就绪");
    readyButton.setAttribute("aria-pressed", String(ready));
    readyButton.disabled = !connected || !compatible;
    loadoutButton.disabled = !connected || !compatible;
    startButton.hidden = !isHost;
    startButton.disabled = !connected || !compatible || !allReady;
  }

  return { update, destroy() { events.abort(); panel.remove(); battleView.classList.remove("tournament-waiting"); } };
}
