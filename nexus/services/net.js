/* Project Nexus — netcode: Supabase Realtime (presence + broadcast).
   Owner-authoritative: you simulate yourself; others see a smoothed ghost.
   Degrades silently to solo play offline or when the CDN client is absent. */
import * as THREE from 'three';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';

function nameSprite(name) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 56;
  const g = c.getContext('2d');
  g.font = '700 30px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const w = Math.min(246, g.measureText(name).width + 26);
  g.fillStyle = 'rgba(6,12,20,0.62)';
  g.beginPath(); g.roundRect((256 - w) / 2, 6, w, 44, 10); g.fill();
  g.fillStyle = '#ffe9a8'; g.fillText(name, 128, 29);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(2.3, 0.5, 1);
  sp.position.y = 2.25;
  return sp;
}

export class Net {
  constructor(scene, gltf, getLocalState, myName) {
    this.scene = scene; this.gltf = gltf;
    this.getLocalState = getLocalState;
    this.myName = myName || 'Player1';
    this.id = 'nx-' + Math.random().toString(36).slice(2, 9);
    this.peers = new Map(); // id -> ghost
    this.online = false;
    this._sendT = 0;
  }

  async init() {
    try {
      if (!window.supabase) return; // CDN client absent (offline / local test)
      const src = await (await fetch(new URL('../../js/arcade.js', import.meta.url).href)).text();
      const url = (src.match(/SUPABASE_URL\s*=\s*"([^"]+)"/) || [])[1];
      const key = (src.match(/SUPABASE_ANON\s*=\s*"([^"]+)"/) || [])[1];
      if (!url || !key) return;
      this.client = window.supabase.createClient(url, key);
      const ch = this.client.channel('nexus-sandbox-1', {
        config: { presence: { key: this.id }, broadcast: { self: false } },
      });
      this.channel = ch;
      ch.on('presence', { event: 'sync' }, () => this._syncPresence());
      ch.on('broadcast', { event: 'pos' }, ({ payload }) => this._onPos(payload));
      await ch.subscribe(async status => {
        if (status === 'SUBSCRIBED') {
          this.online = true;
          await ch.track({ name: this.myName });
        }
      });
    } catch (e) { /* solo mode */ }
  }

  _syncPresence() {
    if (!this.channel) return;
    const state = this.channel.presenceState();
    const seen = new Set();
    for (const key of Object.keys(state)) {
      if (key === this.id) continue;
      seen.add(key);
      if (!this.peers.has(key)) this._addGhost(key, (state[key][0] || {}).name || 'Player');
    }
    for (const id of [...this.peers.keys()]) if (!seen.has(id)) this._removeGhost(id);
  }

  _addGhost(id, name) {
    const model = skeletonClone(this.gltf.scene);
    // per-peer tint so ghosts are distinguishable (palette by id hash)
    const palette = [0xff9d7a, 0x7ac2ff, 0xa8ff9e, 0xffe27a, 0xd8a2ff, 0x7affdd];
    let hsum = 0; for (const ch of id) hsum += ch.charCodeAt(0);
    const tint = new THREE.Color(palette[hsum % palette.length]);
    model.traverse(o => {
      if (o.isMesh) {
        o.castShadow = true;
        if (o.material && o.material.map) { o.material = o.material.clone(); o.material.color.copy(tint); }
      }
    });
    model.add(nameSprite(name));
    this.scene.add(model);
    const mixer = new THREE.AnimationMixer(model);
    const actions = {};
    for (const clip of this.gltf.animations) actions[clip.name] = mixer.clipAction(clip);
    actions.Idle && actions.Idle.play();
    this.peers.set(id, { model, mixer, actions, current: actions.Idle, target: null, ry: 0, sp: 0, name });
  }

  _removeGhost(id) {
    const g = this.peers.get(id);
    if (g) { this.scene.remove(g.model); this.peers.delete(id); }
  }

  _onPos(p) {
    const g = this.peers.get(p.id);
    if (!g) return;
    g.target = { x: p.x, y: p.y, z: p.z };
    g.ry = p.ry; g.sp = p.sp;
  }

  _play(g, name) {
    const next = g.actions[name];
    if (!next || g.current === next) return;
    next.reset().setEffectiveWeight(1).fadeIn(0.18).play();
    if (g.current) g.current.fadeOut(0.18);
    g.current = next;
  }

  /* called every frame from render */
  update(dt, now) {
    if (this.online && now - this._sendT > 120) {
      this._sendT = now;
      const s = this.getLocalState();
      this.channel.send({ type: 'broadcast', event: 'pos', payload: { id: this.id, x: +s.x.toFixed(2), y: +s.y.toFixed(2), z: +s.z.toFixed(2), ry: +s.ry.toFixed(2), sp: +s.sp.toFixed(1) } });
    }
    for (const g of this.peers.values()) {
      if (g.target) {
        const p = g.model.position;
        const d = Math.hypot(g.target.x - p.x, g.target.z - p.z);
        if (d > 14) p.set(g.target.x, g.target.y, g.target.z);
        else {
          const k = 1 - Math.pow(0.00005, dt);
          p.x += (g.target.x - p.x) * k;
          p.y += (g.target.y - p.y) * k;
          p.z += (g.target.z - p.z) * k;
        }
        let dr = g.ry + Math.PI - p.rotation.y;
        while (dr > Math.PI) dr -= Math.PI * 2;
        while (dr < -Math.PI) dr += Math.PI * 2;
        g.model.rotation.y += dr * Math.min(1, 10 * dt);
      }
      const s = g.sp;
      if (s < 0.35) this._play(g, 'Idle');
      else if (s < 5) this._play(g, 'Walk');
      else this._play(g, 'Run');
      g.mixer.update(dt);
    }
  }

  get peerCount() { return this.peers.size; }
}
