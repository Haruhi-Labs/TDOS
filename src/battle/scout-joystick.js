const TAU = Math.PI * 2;
const OCTANT_ZONES = Object.freeze([6, 9, 8, 7, 4, 1, 2, 3]);
const OUTER_ZONE_INDEX = new Map(OCTANT_ZONES.map((zoneId, index) => [zoneId, index]));
const DEFAULT_DEAD_ZONE = 14;
const CENTER_RETURN_RATIO = 0.72;
const ANGLE_HYSTERESIS = 6 * (Math.PI / 180);
const MAX_THUMB_TRAVEL = 52;
const RUBBER_BAND_SIZE = 28;

function normalizedOctant(angle) {
  return ((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8;
}

function shortestAngleDelta(a, b) {
  let delta = (a - b) % TAU;
  if (delta > Math.PI) delta -= TAU;
  if (delta < -Math.PI) delta += TAU;
  return delta;
}

// 屏幕方向与 3×3 战区一一对应：上=2、右上=3、右=6……中心死区=5。
export function scoutZoneFromVector(dx, dy, deadZone = DEFAULT_DEAD_ZONE) {
  const x = Number(dx);
  const y = Number(dy);
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.hypot(x, y) < Math.max(0, deadZone)) {
    return 5;
  }
  return OCTANT_ZONES[normalizedOctant(Math.atan2(y, x))];
}

function zoneWithHysteresis(dx, dy, previousZone, deadZone) {
  const distance = Math.hypot(dx, dy);
  if (previousZone !== 5 && distance >= deadZone * CENTER_RETURN_RATIO) {
    const previousIndex = OUTER_ZONE_INDEX.get(previousZone);
    if (Number.isInteger(previousIndex)) {
      const angle = Math.atan2(dy, dx);
      const centerAngle = previousIndex * (Math.PI / 4);
      if (Math.abs(shortestAngleDelta(angle, centerAngle)) <= Math.PI / 8 + ANGLE_HYSTERESIS) {
        return previousZone;
      }
    }
  }
  return scoutZoneFromVector(dx, dy, deadZone);
}

function rubberBandTravel(distance) {
  if (distance <= MAX_THUMB_TRAVEL) {
    return distance;
  }
  const overshoot = distance - MAX_THUMB_TRAVEL;
  return MAX_THUMB_TRAVEL
    + (overshoot * RUBBER_BAND_SIZE * 0.48) / (RUBBER_BAND_SIZE + overshoot * 0.48);
}

function buildJoystickVisual(documentObject) {
  const visual = documentObject.createElement("div");
  visual.className = "scout-joystick";
  visual.setAttribute("aria-hidden", "true");

  const readout = documentObject.createElement("div");
  readout.className = "scout-joystick-readout";
  visual.append(readout);

  const base = documentObject.createElement("div");
  base.className = "scout-joystick-base";
  for (let zoneId = 1; zoneId <= 9; zoneId += 1) {
    const sector = documentObject.createElement("span");
    sector.className = "scout-joystick-sector";
    sector.dataset.zone = String(zoneId);
    sector.textContent = String(zoneId);
    base.append(sector);
  }

  const thumb = documentObject.createElement("span");
  thumb.className = "scout-joystick-thumb";
  const thumbZone = documentObject.createElement("span");
  thumbZone.className = "scout-joystick-thumb-zone";
  thumbZone.textContent = "5";
  thumb.append(thumbZone);
  base.append(thumb);
  visual.append(base);

  return {
    visual,
    readout,
    thumb,
    thumbZone,
    sectors: Array.from(base.querySelectorAll(".scout-joystick-sector")),
  };
}

function vibrate(navigatorObject, pattern) {
  if (typeof navigatorObject?.vibrate === "function") {
    navigatorObject.vibrate(pattern);
  }
}

export function createMobileScoutJoystick({
  button,
  onCommit,
  formatZone = (zoneId) => `战区${zoneId}`,
  formatReadout = (zoneId) => `松手释放 · ${formatZone(zoneId)}`,
  signal,
  deadZone = DEFAULT_DEAD_ZONE,
} = {}) {
  if (!button || typeof onCommit !== "function") {
    return { destroy() {} };
  }

  const documentObject = button.ownerDocument;
  const view = documentObject.defaultView || window;
  const listenerController = new view.AbortController();
  const label = button.querySelector(".mobile-scout-label");
  const idleLabel = label ? label.textContent : button.textContent;
  const joystick = buildJoystickVisual(documentObject);
  documentObject.body.append(joystick.visual);

  let gesture = null;
  let dismissTimer = 0;
  let swallowTimer = 0;
  let swallowClick = false;
  let destroyed = false;

  const options = { signal: listenerController.signal };
  const moveOptions = { signal: listenerController.signal, passive: false };

  function setLabel(text) {
    if (label) label.textContent = text;
  }

  function updateSelectedZone(zoneId) {
    if (!gesture || gesture.zoneId === zoneId) {
      return;
    }
    gesture.zoneId = zoneId;
    joystick.thumbZone.textContent = String(zoneId);
    joystick.readout.textContent = formatReadout(zoneId);
    setLabel(formatZone(zoneId));
    for (const sector of joystick.sectors) {
      sector.classList.toggle("is-selected", Number(sector.dataset.zone) === zoneId);
    }
    if (gesture.pointerType !== "mouse") {
      vibrate(view.navigator, 7);
    }
  }

  function updatePointer(clientX, clientY) {
    if (!gesture) return;
    const dx = clientX - gesture.originX;
    const dy = clientY - gesture.originY;
    const distance = Math.hypot(dx, dy);
    const zoneId = zoneWithHysteresis(dx, dy, gesture.zoneId, deadZone);
    updateSelectedZone(zoneId);

    const travel = rubberBandTravel(distance);
    const ratio = distance > 1e-6 ? travel / distance : 0;
    joystick.thumb.style.transform = `translate3d(${(dx * ratio).toFixed(2)}px, ${(dy * ratio).toFixed(2)}px, 0) translate(-50%, -50%)`;
  }

  function armClickSwallow() {
    swallowClick = true;
    clearTimeout(swallowTimer);
    swallowTimer = view.setTimeout(() => { swallowClick = false; }, 900);
  }

  function hideVisual(className = "") {
    button.classList.remove("scout-aiming");
    button.setAttribute("aria-pressed", "false");
    joystick.visual.classList.remove("is-active");
    joystick.visual.classList.toggle("is-committed", className === "is-committed");
    joystick.visual.classList.toggle("is-rejected", className === "is-rejected");
    clearTimeout(dismissTimer);
    dismissTimer = view.setTimeout(() => {
      joystick.visual.classList.remove("is-committed", "is-rejected");
      joystick.thumb.style.transform = "translate3d(0, 0, 0) translate(-50%, -50%)";
      setLabel(idleLabel);
    }, 180);
  }

  function releaseCapture(pointerId) {
    if (typeof button.hasPointerCapture === "function" && button.hasPointerCapture(pointerId)) {
      button.releasePointerCapture(pointerId);
    }
  }

  function cancelGesture() {
    if (!gesture) return;
    const { pointerId } = gesture;
    gesture = null;
    releaseCapture(pointerId);
    hideVisual();
  }

  function finishGesture(event) {
    if (!gesture || event.pointerId !== gesture.pointerId) {
      return;
    }
    updatePointer(event.clientX, event.clientY);
    const { zoneId, pointerId, pointerType } = gesture;
    gesture = null;
    releaseCapture(pointerId);
    const accepted = onCommit(zoneId) !== false;
    hideVisual(accepted ? "is-committed" : "is-rejected");
    if (pointerType !== "mouse") {
      vibrate(view.navigator, accepted ? 18 : [12, 22, 12]);
    }
  }

  function handlePointerDown(event) {
    if (destroyed || gesture || button.disabled || event.button !== 0 || event.isPrimary === false) {
      return;
    }
    event.preventDefault();
    armClickSwallow();
    clearTimeout(dismissTimer);
    joystick.visual.classList.remove("is-committed", "is-rejected");
    gesture = {
      pointerId: event.pointerId,
      pointerType: event.pointerType || "touch",
      originX: event.clientX,
      originY: event.clientY,
      zoneId: 0,
    };
    if (typeof button.setPointerCapture === "function") {
      button.setPointerCapture(event.pointerId);
    }
    button.classList.add("scout-aiming");
    button.setAttribute("aria-pressed", "true");
    joystick.visual.style.left = `${event.clientX}px`;
    joystick.visual.style.top = `${event.clientY}px`;
    joystick.visual.classList.add("is-active");
    updateSelectedZone(5);
    joystick.thumb.style.transform = "translate3d(0, 0, 0) translate(-50%, -50%)";
    if (gesture.pointerType !== "mouse") vibrate(view.navigator, 5);
  }

  function handlePointerMove(event) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    if (event.cancelable) event.preventDefault();
    updatePointer(event.clientX, event.clientY);
  }

  function handlePointerUp(event) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    if (event.cancelable) event.preventDefault();
    finishGesture(event);
  }

  function handleClick(event) {
    if (swallowClick) {
      swallowClick = false;
      clearTimeout(swallowTimer);
      event.preventDefault();
      return;
    }
    if (button.disabled || event.detail !== 0) {
      return;
    }
    // 键盘 Enter / Space 与辅助技术激活没有 pointer 序列，按“直接点击=中央战区”处理。
    onCommit(5);
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    cancelGesture();
    clearTimeout(dismissTimer);
    clearTimeout(swallowTimer);
    listenerController.abort();
    signal?.removeEventListener("abort", destroy);
    joystick.visual.remove();
  }

  button.addEventListener("pointerdown", handlePointerDown, options);
  button.addEventListener("pointermove", handlePointerMove, moveOptions);
  button.addEventListener("pointerup", handlePointerUp, options);
  button.addEventListener("pointercancel", cancelGesture, options);
  button.addEventListener("lostpointercapture", cancelGesture, options);
  button.addEventListener("click", handleClick, options);
  view.addEventListener("blur", cancelGesture, options);
  documentObject.addEventListener("visibilitychange", () => {
    if (documentObject.hidden) cancelGesture();
  }, options);
  if (signal) {
    signal.addEventListener("abort", destroy, { once: true });
    if (signal.aborted) destroy();
  }

  return { destroy };
}
