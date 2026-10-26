// A tap is activated on a completed, stationary touch. This also handles mobile
// browsers that suppress the compatibility click after captured look/joystick
// gestures. Mouse clicks and keyboard/assistive activation keep native behavior.
export function bindAction(button, action) {
  let start = null,
    lastTouch = -Infinity;
  button.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "touch" && !button.disabled)
      start = { id: e.pointerId, x: e.clientX, y: e.clientY };
  });
  button.addEventListener("pointermove", (e) => {
    if (
      start &&
      e.pointerId === start.id &&
      Math.hypot(e.clientX - start.x, e.clientY - start.y) > 12
    )
      start = null;
  });
  button.addEventListener("pointercancel", () => {
    start = null;
  });
  button.addEventListener("pointerup", (e) => {
    if (!start || start.id !== e.pointerId) return;
    start = null;
    const r = button.getBoundingClientRect();
    if (
      button.disabled ||
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      return;
    lastTouch = e.timeStamp;
    e.preventDefault();
    action(e);
  });
  button.addEventListener("click", (e) => {
    if (e.detail > 0 && e.timeStamp - lastTouch < 700) {
      e.preventDefault();
      return;
    }
    action(e);
  });
}
