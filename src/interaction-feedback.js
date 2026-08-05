const PRESSABLE_SELECTOR = [
  "button:not(:disabled)",
  "a[href]",
  '[role="button"]:not([aria-disabled="true"])',
].join(",");

function pressableFromEvent(event) {
  const target = event.target;
  return target && typeof target.closest === "function"
    ? target.closest(PRESSABLE_SELECTOR)
    : null;
}

// 原生 :active 在触屏浏览器上可能保留到下一次触摸；这里显式维护只存在于
// pointerdown → pointerup/cancel 之间的按压态，并只清理由指针产生的焦点。
export function installInteractionFeedback({
  documentObject = document,
  windowObject = documentObject.defaultView || window,
} = {}) {
  const controller = new windowObject.AbortController();
  const listenerOptions = { capture: true, signal: controller.signal };
  let pressedElement = null;
  let pressedPointerId = null;

  function clearPressed(pointerId = pressedPointerId) {
    if (pressedPointerId !== null && pointerId !== pressedPointerId) {
      return;
    }
    pressedElement?.classList.remove("is-pressing");
    pressedElement = null;
    pressedPointerId = null;
  }

  documentObject.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.isPrimary === false) {
      return;
    }
    const pressable = pressableFromEvent(event);
    if (!pressable) {
      clearPressed();
      return;
    }
    clearPressed();
    pressedElement = pressable;
    pressedPointerId = event.pointerId;
    pressable.classList.add("is-pressing");
  }, listenerOptions);

  windowObject.addEventListener("pointerup", (event) => clearPressed(event.pointerId), listenerOptions);
  windowObject.addEventListener("pointercancel", (event) => clearPressed(event.pointerId), listenerOptions);
  windowObject.addEventListener("blur", () => clearPressed(), listenerOptions);
  documentObject.addEventListener("dragstart", () => clearPressed(), listenerOptions);
  documentObject.addEventListener("contextmenu", () => clearPressed(), listenerOptions);
  documentObject.addEventListener("visibilitychange", () => {
    if (documentObject.hidden) clearPressed();
  }, listenerOptions);

  // 鼠标和触摸点击结束后不保留焦点外观；键盘或辅助技术产生的 click
  // detail 为 0，继续保留 focus-visible，避免破坏键盘导航。
  documentObject.addEventListener("click", (event) => {
    if (event.detail === 0) {
      return;
    }
    const pressable = pressableFromEvent(event);
    if (!pressable) {
      return;
    }
    windowObject.requestAnimationFrame(() => {
      if (documentObject.activeElement === pressable) {
        pressable.blur();
      }
    });
  }, listenerOptions);

  return () => {
    clearPressed();
    controller.abort();
  };
}
