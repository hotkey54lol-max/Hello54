/* Demolition Day — boot: Nexus engine + the Demolition game module.
   Same core wiring as the sandbox boot (engine/env/physics/character/
   net/npc/audio/governor/settings), with the free-play dock replaced by
   the challenge system in game/demolition.js. */
import { Engine } from './core/engine.js';
import { Input } from './core/input.js';
import { Environment, heightAt } from './world/environment.js';
import * as THREE from 'three';
import { Physics } from './world/physics.js';
import { Character } from './game/character.js';
import { Sandbox } from './game/sandbox.js';
import { Demolition, CHALLENGES } from './game/demolition.js';
import { Net } from './services/net.js';
import { AudioService } from './services/audio.js';
import { Particles } from './services/particles.js';
import { Npc } from './services/npc.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export async function boot() {
  const status = msg => { const el = document.getElementById('nxStatus'); if (el) el.textContent = msg; };
  const canvas = document.getElementById('nxCanvas');
  const engine = new Engine(canvas);
  const input = new Input(canvas);
  engine.setPixelScale(1);

  status('Growing the island…');
  const env = new Environment(engine.scene, engine.renderer);

  status('Waking physics (Rapier)…');
  const physics = new Physics();
  await physics.init(env.terrainData, env.scatter);

  status('Dressing the character…');
  const gltf = await new GLTFLoader().loadAsync(new URL('./assets/models/Soldier.glb', import.meta.url).href);
  const character = new Character(engine.scene, physics, input, gltf);
  await character.init();
  physics.trackCharacter(character.body);

  const sandbox = new Sandbox(engine.scene, physics, character, env);
  physics.onSplash = (x, z, power) => sandbox.splash(x, z, power);
  const particles = new Particles(engine.scene);

  let myName = 'Player1';
  try { myName = localStorage.getItem('arcade_name') || 'Player1'; } catch (e) {}
  const net = new Net(engine.scene, gltf, () => {
    const p = character.pos;
    return { x: p.x, y: p.y, z: p.z, ry: character.faceYaw, sp: character.speed2d };
  }, myName);
  net.init();

  const npc = new Npc(engine.scene, gltf);

  /* ---- Demolition Day game state + UI ---- */
  const toast = document.getElementById('nxToast');
  let toastTimer = null;
  const showToast = msg => {
    if (!toast) return;
    toast.textContent = msg;
    toast.style.opacity = 1;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.style.opacity = 0; }, 3200);
  };
  const runHud = document.getElementById('ddHud');
  const toolBtn = document.getElementById('ddTool');
  const finishBtn = document.getElementById('ddFinish');
  const quitBtn = document.getElementById('ddQuit');
  const panel = document.getElementById('ddPanel');
  const panelBody = document.getElementById('ddPanelBody');

  function renderGameUI(game) {
    const running = game.state === 'running';
    const done = game.state === 'done';
    if (toolBtn) {
      toolBtn.style.display = running ? '' : 'none';
      toolBtn.textContent = game.def ? game.def.toolLabel + ' (' + game.toolsLeft + ')' : '';
      toolBtn.disabled = !running || game.toolsLeft <= 0;
    }
    if (finishBtn) finishBtn.style.display = running ? '' : 'none';
    if (quitBtn) quitBtn.style.display = running || done ? '' : 'none';
    if (runHud) {
      if (running && game.def) {
        runHud.style.display = 'block';
        runHud.textContent = game.def.icon + ' ' + game.def.name + ' · down ' + game.count() + '/' + game.total() + ' · ⏱ ' + Math.floor(game.elapsed) + 's';
      } else runHud.style.display = 'none';
    }
    if (panel) {
      if (done && game.result) {
        const r = game.result;
        panel.style.display = 'block';
        panelBody.innerHTML =
          '<div style="font-size:1.5rem">' + r.icon + ' ' + r.name + '</div>' +
          '<div style="font-size:1.1rem;margin:6px 0">' + '★'.repeat(r.stars) + '<span style="opacity:.35">' + '★'.repeat(3 - r.stars) + '</span></div>' +
          '<div>Down: <b>' + r.count + '/' + r.total + '</b> · Time: <b>' + r.secs + 's</b></div>' +
          '<div style="font-size:1.25rem;margin-top:6px">Score: <b style="color:#ffd94d">' + r.points + '</b></div>' +
          (r.reason === 'cleared' ? '<div style="color:#8dff9a">Cleared!</div>' : '');
        refreshBoard(r.id);
      } else panel.style.display = 'none';
    }
    document.querySelectorAll('[data-challenge]').forEach(b => {
      const id = b.dataset.challenge;
      const starEl = b.querySelector('.dd-stars');
      if (starEl) {
        const s = game.stars[id] || 0;
        starEl.textContent = s ? ' ' + '★'.repeat(s) : '';
      }
    });
  }

  const game = new Demolition(engine.scene, physics, character, sandbox, {
    toast: showToast,
    onRun: g => renderGameUI(g),
  });

  async function refreshBoard(challengeId) {
    const boardEl = document.getElementById('ddBoard');
    if (!boardEl || !window.Arcade) return;
    const def = CHALLENGES.find(c => c.id === challengeId) || CHALLENGES[0];
    const rows = await window.Arcade.getScores(def.board, 5);
    boardEl.innerHTML = '<b>' + def.icon + ' ' + def.name + ' — top scores</b>' +
      (rows.length ? rows.map(r => '<div>' + String(r.player_name).replace(/</g, '&lt;') + ' — ' + r.score + '</div>').join('') : '<div>No scores yet — be the first!</div>');
  }

  document.querySelectorAll('[data-challenge]').forEach(b =>
    b.addEventListener('click', () => { game.start(b.dataset.challenge); refreshBoard(b.dataset.challenge); }));
  if (toolBtn) toolBtn.addEventListener('click', () => game.useTool());
  if (finishBtn) finishBtn.addEventListener('click', () => game.finish('called'));
  if (quitBtn) quitBtn.addEventListener('click', () => game.quit());
  const retryBtn = document.getElementById('ddRetry');
  const nextBtn = document.getElementById('ddNext');
  const menuBtn = document.getElementById('ddMenu');
  if (retryBtn) retryBtn.addEventListener('click', () => { if (game.result) game.start(game.result.id); });
  if (nextBtn) nextBtn.addEventListener('click', () => {
    if (!game.result) return;
    const i = CHALLENGES.findIndex(c => c.id === game.result.id);
    game.start(CHALLENGES[(i + 1) % CHALLENGES.length].id);
  });
  if (menuBtn) menuBtn.addEventListener('click', () => game.quit());
  refreshBoard('tower');

  engine.addSystem({ beginFrame: () => physics.beginFrame(), step: dt => { physics.step(dt); } });
  engine.addSystem({ step: dt => { env.update(dt); } });
  const trap = (name, fn) => {
    try { fn(); } catch (e) {
      if (!engine._renderErr) {
        engine._renderErr = name + ': ' + (e && e.message ? e.message : e);
        console.error('[nexus-render] ' + engine._renderErr);
      }
    }
  };
  engine.addSystem({
    render: (alpha, dt) => {
      trap('character', () => character.render(alpha, dt, engine.camera));
      trap('props', () => physics.syncProps(alpha));
      trap('sandbox', () => sandbox.render(dt));
      trap('demolition', () => { game.update(dt); if (game.state === 'running') renderGameUI(game); });
      trap('particles', () => particles.update(dt, character.pos, env.daylight ?? 1, env.effWet, env.effWind));
      trap('audio', () => audio.update(dt, { speed: character.speed2d, grounded: character.grounded, vy: character.vy, wet: env.effWet, wind: env.effWind }));
      trap('net', () => net.update(dt, performance.now()));
      trap('npc', () => npc.update(dt));
      trap('shadows', () => env.followShadows(character.model.position));
    },
  });

  engine.onGovernor = (factor, dir) => {
    const low = factor <= 0.65;
    env.setLowFx(low); sandbox.setLowFx(low); particles.setLowFx(low);
    showToast(dir === 'down'
      ? '⚡ Auto-graphics: easing quality to ' + Math.round(factor * 100) + '% so the frame rate holds'
      : '⚡ Auto-graphics: restoring quality to ' + Math.round(factor * 100) + '%');
  };

  /* environment controls (kept from the sandbox shell) */
  const timeSlider = document.getElementById('nxTime');
  if (timeSlider) timeSlider.addEventListener('input', () => { env.autoCycle = false; env.setTime(parseFloat(timeSlider.value)); syncCycleBtn(); });
  const cycleBtn = document.getElementById('nxCycle');
  function syncCycleBtn() { if (cycleBtn) cycleBtn.textContent = env.autoCycle ? '🕐 Cycle: ON' : '🕐 Cycle: off'; }
  if (cycleBtn) cycleBtn.addEventListener('click', () => { env.autoCycle = !env.autoCycle; syncCycleBtn(); });
  const rainBtn = document.getElementById('nxRain');
  const weatherModes = [['auto', '🌦 Weather: Auto'], ['clear', '☀ Weather: Clear'], ['cloudy', '☁ Weather: Cloudy'], ['rain', '🌧 Weather: Rain'], ['storm', '⛈ Weather: Storm']];
  let weatherIdx = 0;
  function syncWeatherBtn() { if (rainBtn) rainBtn.textContent = weatherModes[weatherIdx][1]; }
  if (rainBtn) rainBtn.addEventListener('click', () => {
    weatherIdx = (weatherIdx + 1) % weatherModes.length;
    env.setWeather(weatherModes[weatherIdx][0]);
    syncWeatherBtn();
  });
  const stormBtn = document.getElementById('nxStorm');
  if (stormBtn) stormBtn.addEventListener('click', () => env.summonStorm(true));
  window.addEventListener('keydown', e => {
    if (e.code === 'KeyH') document.body.classList.toggle('ui-hidden');
    if (e.code === 'KeyT') env.summonStorm(true);
  });

  const audio = new AudioService();
  sandbox.sfx = audio;
  env.sfx = audio;
  const gesture = () => audio.ensure();
  window.addEventListener('pointerdown', gesture);
  window.addEventListener('keydown', gesture);
  const soundBtn = document.getElementById('nxSound');
  if (soundBtn) soundBtn.addEventListener('click', () => {
    audio.ensure();
    audio.setMuted(!audio.muted);
    soundBtn.textContent = audio.muted ? '🔇 Sound: off' : '🔊 Sound: on';
  });

  /* settings panel (same ids/behavior as the sandbox page) */
  const settings = (() => { try { return JSON.parse(localStorage.getItem('nx_settings') || '{}'); } catch (e) { return {}; } })();
  const saveSettings = () => { try { localStorage.setItem('nx_settings', JSON.stringify(settings)); } catch (e) {} };
  const scaleSel = document.getElementById('nxScale');
  const shChk = document.getElementById('nxShadows');
  const blChk = document.getElementById('nxBloom');
  const aoChk = document.getElementById('nxAO');
  const filmChk = document.getElementById('nxFilm');
  function applySettings() {
    const sc = parseFloat(settings.scale || '1');
    engine.setPixelScale(sc);
    if (scaleSel) scaleSel.value = String(settings.scale || '1');
    env.sun.castShadow = settings.shadows !== false;
    if (shChk) shChk.checked = settings.shadows !== false;
    engine.userBloom = settings.bloom !== false;
    engine.bloom.enabled = engine.userBloom && engine.govFactor > 0.65;
    if (blChk) blChk.checked = settings.bloom !== false;
    engine.userAO = settings.ao !== false;
    engine.ao.enabled = engine.userAO && engine.govFactor > 0.85;
    if (aoChk) aoChk.checked = settings.ao !== false;
    engine.userFilm = settings.film !== false;
    engine.film.enabled = engine.userFilm && engine.govFactor > 0.65;
    if (filmChk) filmChk.checked = settings.film !== false;
  }
  if (scaleSel) scaleSel.addEventListener('change', () => { settings.scale = scaleSel.value; saveSettings(); applySettings(); });
  if (shChk) shChk.addEventListener('change', () => { settings.shadows = shChk.checked; saveSettings(); applySettings(); });
  if (blChk) blChk.addEventListener('change', () => { settings.bloom = blChk.checked; saveSettings(); applySettings(); });
  if (aoChk) aoChk.addEventListener('change', () => { settings.ao = aoChk.checked; saveSettings(); applySettings(); });
  if (filmChk) filmChk.addEventListener('change', () => { settings.film = filmChk.checked; saveSettings(); applySettings(); });
  const setBtn = document.getElementById('nxSettingsBtn');
  const setPanel = document.getElementById('nxSettings');
  if (setBtn && setPanel) setBtn.addEventListener('click', () => {
    setPanel.style.display = setPanel.style.display === 'none' ? 'block' : 'none';
  });
  applySettings();

  const jumpBtn = document.getElementById('nxJump');
  if (jumpBtn && 'ontouchstart' in window) {
    jumpBtn.style.display = 'block';
    jumpBtn.addEventListener('touchstart', e => { e.preventDefault(); input.keys['Space'] = true; }, { passive: false });
    jumpBtn.addEventListener('touchend', e => { e.preventDefault(); input.keys['Space'] = false; }, { passive: false });
  }

  const hud = document.getElementById('nxHud');
  setInterval(() => {
    if (!hud) return;
    const f = engine.frame;
    hud.textContent = 'FPS ' + f.fps + ' · ' + f.ms.toFixed(1) + 'ms · sim ' + f.simMs.toFixed(1) + 'ms · draws ' + f.calls + ' · tris ' + (f.tris / 1000).toFixed(0) + 'k · bodies ' + physics.bodyCount + ' · props ' + physics.props.length + ' · gov ' + Math.round(engine.govFactor * 100) + '%' +
      ' · MP ' + (net.online ? 'on' : 'off') + ' peers ' + net.peerCount + ' rx ' + net.rxCount + (net.lastErr ? ' ERR ' + net.lastErr : '');
  }, 200);

  window.__nx = {
    ready: true,
    pos: () => character.pos,
    fps: () => engine.frame.fps,
    props: () => physics.props.length,
    kinds: () => physics.props.map(p => p.kind),
    propsPos: () => physics.props.map(p => [p.kind, +p.mesh.position.x.toFixed(1), +p.mesh.position.z.toFixed(1)]),
    press: (code, down) => { input.keys[code] = !!down; },
    setCam: (yaw, pitch, dist) => { character.camYaw = yaw; if (pitch !== undefined) character.camPitch = pitch; if (dist !== undefined) character.camDist = dist; },
    renderErr: () => engine._renderErr || '',
    ddStart: id => game.start(id),
    ddState: () => game.state,
    ddCount: () => ({ count: game.count(), total: game.total(), elapsed: +game.elapsed.toFixed(1), toolsLeft: game.toolsLeft }),
    ddTool: () => game.useTool(),
    ddFinish: () => game.finish('called'),
    ddResult: () => game.result,
    ddQuit: () => game.quit(),
  };

  renderGameUI(game);
  status('');
  const load = document.getElementById('nxLoading');
  if (load) load.style.display = 'none';
  engine.start();
  return { engine, env, physics, character, sandbox, game };
}
