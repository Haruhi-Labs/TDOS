// 对战场景 BGM 单例：所有战斗模式共用同一 HTMLAudioElement。
// - start/stop 幂等；tab 隐藏自动暂停；autoplay 失败时等手势再试
// - 静音状态持久化到 localStorage

import { t } from "./i18n.js";

const MUTE_STORAGE_KEY = "haruhi.battleBgm.muted";
const DEFAULT_VOLUME = 0.4;
const BGM_URL = `${import.meta.env.BASE_URL}assets/audio/battle-bgm.aac`;

let audio = null;
let wanted = false;
let gestureBound = false;
let visibilityBound = false;
let localeBound = false;
let muteButton = null;

function ensureAudio() {
  if (audio) {
    return audio;
  }
  audio = new Audio(BGM_URL);
  audio.loop = true;
  audio.preload = "auto";
  audio.volume = isBattleBgmMuted() ? 0 : DEFAULT_VOLUME;
  return audio;
}

function readMuted() {
  try {
    return window.localStorage.getItem(MUTE_STORAGE_KEY) === "1";
  } catch (_error) {
    return false;
  }
}

function writeMuted(muted) {
  try {
    window.localStorage.setItem(MUTE_STORAGE_KEY, muted ? "1" : "0");
  } catch (_error) {
    // ignore quota / private mode
  }
}

export function isBattleBgmMuted() {
  return readMuted();
}

function applyVolume() {
  if (!audio) {
    return;
  }
  audio.volume = isBattleBgmMuted() ? 0 : DEFAULT_VOLUME;
}

function clearGestureRetry() {
  if (!gestureBound) {
    return;
  }
  window.removeEventListener("pointerdown", onGestureUnlock, true);
  window.removeEventListener("keydown", onGestureUnlock, true);
  gestureBound = false;
}

function onGestureUnlock() {
  if (!wanted) {
    clearGestureRetry();
    return;
  }
  tryPlay();
}

function armGestureRetry() {
  if (gestureBound || !wanted) {
    return;
  }
  gestureBound = true;
  window.addEventListener("pointerdown", onGestureUnlock, true);
  window.addEventListener("keydown", onGestureUnlock, true);
}

function tryPlay() {
  const el = ensureAudio();
  applyVolume();
  if (!wanted) {
    return;
  }
  // 已在播且未结束则无需重入
  if (!el.paused && !el.ended) {
    clearGestureRetry();
    return;
  }
  const playPromise = el.play();
  if (playPromise && typeof playPromise.then === "function") {
    playPromise
      .then(() => {
        clearGestureRetry();
      })
      .catch(() => {
        armGestureRetry();
      });
  }
}

function onVisibilityChange() {
  if (!wanted) {
    return;
  }
  if (document.hidden) {
    if (audio && !audio.paused) {
      audio.pause();
    }
    return;
  }
  tryPlay();
}

function ensureVisibilityListener() {
  if (visibilityBound) {
    return;
  }
  visibilityBound = true;
  document.addEventListener("visibilitychange", onVisibilityChange);
}

function syncMuteButton() {
  if (!muteButton) {
    return;
  }
  const muted = isBattleBgmMuted();
  muteButton.setAttribute("aria-pressed", muted ? "true" : "false");
  muteButton.textContent = muted ? t("取消静音") : t("静音");
  muteButton.title = muted ? t("取消静音") : t("静音");
}

export function setBattleBgmMuted(muted) {
  writeMuted(Boolean(muted));
  applyVolume();
  syncMuteButton();
  if (wanted && !document.hidden) {
    tryPlay();
  }
}

export function startBattleBgm() {
  wanted = true;
  ensureVisibilityListener();
  ensureAudio();
  if (document.hidden) {
    return;
  }
  tryPlay();
}

export function stopBattleBgm() {
  wanted = false;
  clearGestureRetry();
  if (!audio) {
    return;
  }
  audio.pause();
  try {
    audio.currentTime = 0;
  } catch (_error) {
    // ignore seek errors before metadata
  }
}

export function bindBattleBgmMuteButton(btn) {
  if (!btn) {
    return;
  }
  if (muteButton && muteButton !== btn) {
    muteButton.onclick = null;
  }
  muteButton = btn;
  syncMuteButton();
  btn.onclick = () => {
    // 点击本身可作为 autoplay 解锁手势
    setBattleBgmMuted(!isBattleBgmMuted());
  };
  if (!localeBound) {
    localeBound = true;
    window.addEventListener(
      "haruhi:locale-change",
      () => {
        syncMuteButton();
      },
      { passive: true },
    );
  }
}
