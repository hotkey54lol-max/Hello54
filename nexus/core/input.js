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
