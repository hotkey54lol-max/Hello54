/* Project Nexus — input: unified keyboard/mouse state + named actions.
   Nexus version of Unreal's Enhanced Input: games ask for actions, not keys. */
export class Input {
  constructor(dom) {
    this.keys = {};
    this.mouseDX = 0; this.mouseDY = 0;
    this.dragging = false;
    this.wheelDelta = 0;
    this.touches = { move: null, look: null, moveVec: { x: 0, y: 0 } };
    window.addEventListener('keydown', e => {
      this.keys[e.code] = true;
      if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', e => { this.keys[e.code] = false; });
    dom.addEventListener('mousedown', e => { if (e.button === 0) this.dragging = true; });
    window.addEventListener('mouseup', () => { this.dragging = false; });
    window.addEventListener('mousemove', e => {
      if (this.dragging) { this.mouseDX += e.movementX || 0; this.mouseDY += e.movementY || 0; }
    });
    dom.addEventListener('wheel', e => { this.wheelDelta += e.deltaY; }, { passive: true });
    window.addEventListener('blur', () => { this.keys = {}; this.dragging = false; });
    /* touch: left half = move stick, right half = look drag */
    this._stickId = null; this._stickOrigin = null; this._lookId = null; this._lookLast = null;
    dom.addEventListener('touchstart', e => {
      for (const t of e.changedTouches) {
        if (t.clientX < window.innerWidth / 2 && this._stickId === null) {
          this._stickId = t.identifier; this._stickOrigin = { x: t.clientX, y: t.clientY };
        } else if (this._lookId === null) {
          this._lookId = t.identifier; this._lookLast = { x: t.clientX, y: t.clientY };
        }
      }
      e.preventDefault();
    }, { passive: false });
    dom.addEventListener('touchmove', e => {
      for (const t of e.changedTouches) {
        if (t.identifier === this._stickId && this._stickOrigin) {
          const R = 52;
          let dx = (t.clientX - this._stickOrigin.x) / R, dy = (t.clientY - this._stickOrigin.y) / R;
          const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; }
          this.touches.moveVec.x = dx; this.touches.moveVec.y = dy;
        } else if (t.identifier === this._lookId && this._lookLast) {
          this.mouseDX += (t.clientX - this._lookLast.x) * 2.2;
          this.mouseDY += (t.clientY - this._lookLast.y) * 2.2;
          this._lookLast = { x: t.clientX, y: t.clientY };
        }
      }
      e.preventDefault();
    }, { passive: false });
    const endTouch = e => {
      for (const t of e.changedTouches) {
        if (t.identifier === this._stickId) { this._stickId = null; this._stickOrigin = null; this.touches.moveVec.x = 0; this.touches.moveVec.y = 0; }
        if (t.identifier === this._lookId) { this._lookId = null; this._lookLast = null; }
      }
    };
    dom.addEventListener('touchend', endTouch);
    dom.addEventListener('touchcancel', endTouch);
  }
  down(code) { return !!this.keys[code]; }
  axis() {
    let x = 0, y = 0;
    if (this.down('KeyW') || this.down('ArrowUp')) y -= 1;
    if (this.down('KeyS') || this.down('ArrowDown')) y += 1;
    if (this.down('KeyA') || this.down('ArrowLeft')) x -= 1;
    if (this.down('KeyD') || this.down('ArrowRight')) x += 1;
    x += this.touches.moveVec.x; y += this.touches.moveVec.y;
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    return { x, y };
  }
  consumeLook() { const r = { dx: this.mouseDX, dy: this.mouseDY }; this.mouseDX = 0; this.mouseDY = 0; return r; }
  consumeWheel() { const w = this.wheelDelta; this.wheelDelta = 0; return w; }
}
