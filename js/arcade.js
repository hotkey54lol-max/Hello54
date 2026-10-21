/* Sandbox Arcade shared library.
 * Supabase-backed global high scores. Failures are silent so games
 * always work offline / before the game_scores table exists.
 */
window.Arcade = (function () {
  "use strict";

  const SUPABASE_URL = "https://enwfbvktwxcgintcapep.supabase.co";
  const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVud2Zidmt0d3hjZ2ludGNhcGVwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIzNTg2ODcsImV4cCI6MjEwNzkzNDY4N30.jeIMyCpX7mCTqs_XTdZficaun2sIDveOo8t1oP5FsyU";

  function baseHeaders() {
    return {
      apikey: SUPABASE_ANON,
      Authorization: "Bearer " + SUPABASE_ANON,
      "Content-Type": "application/json",
    };
  }

  // POST a score. Silently ignore all failures.
  async function saveScore(gameId, playerName, score) {
    try {
      const s = Math.round(Number(score));
      if (!isFinite(s)) return;
      await fetch(SUPABASE_URL + "/rest/v1/game_scores", {
        method: "POST",
        headers: Object.assign(baseHeaders(), { Prefer: "return=minimal" }),
        body: JSON.stringify({
          game_id: String(gameId),
          player_name: String(playerName || "anon").slice(0, 24),
          score: s,
        }),
      });
    } catch (e) {
      /* offline or table not created yet — game keeps working */
    }
  }

  // GET top scores for a game, highest first. Returns [] on any failure.
  async function getScores(gameId, limit) {
    limit = limit || 5;
    try {
      const url =
        SUPABASE_URL +
        "/rest/v1/game_scores?game_id=eq." +
        encodeURIComponent(gameId) +
        "&select=player_name,score&order=score.desc&limit=" +
        encodeURIComponent(limit);
      const r = await fetch(url, { headers: baseHeaders() });
      if (!r.ok) return [];
      const rows = await r.json();
      return Array.isArray(rows) ? rows : [];
    } catch (e) {
      return [];
    }
  }

  // Returns the player's arcade name, prompting once and caching in localStorage.
  function playerName() {
    try {
      let n = localStorage.getItem("arcade_name");
      if (!n) {
        n = window.prompt("Enter your arcade name:", "Player1");
        n = (n || "Player1").trim().slice(0, 20) || "Player1";
        localStorage.setItem("arcade_name", n);
      }
      return n;
    } catch (e) {
      return "Player1";
    }
  }

  /* ================= Live event engine =================
   * Admin-triggered page effects, polled from the site_events table.
   * Everything is defensive: any failure is silent and the host page
   * keeps working. Pages can opt out with window.ARCADE_NO_EVENTS=true.
   */
  const EVENTS_URL = SUPABASE_URL + "/rest/v1/site_events";
  const LAST_EVENT_KEY = "arcade_last_event";

  function _fxSafe(fn) {
    try { fn(); } catch (e) { /* never break the host page */ }
  }

  function _lastSeenId() {
    try { return Number(localStorage.getItem(LAST_EVENT_KEY)) || 0; }
    catch (e) { return 0; }
  }
  function _setLastSeenId(id) {
    try { localStorage.setItem(LAST_EVENT_KEY, String(id)); } catch (e) {}
  }

  // POST a live event. Resolves true on success, false on any failure.
  async function triggerEvent(type, payload) {
    try {
      await fetch(EVENTS_URL, {
        method: "POST",
        headers: Object.assign(baseHeaders(), { Prefer: "return=minimal" }),
        body: JSON.stringify({
          event_type: String(type),
          payload: payload == null ? null : String(payload).slice(0, 500),
        }),
      });
      return true;
    } catch (e) {
      return false;
    }
  }

  // GET recent events, newest first. Returns [] on any failure.
  async function recentEvents(limit) {
    limit = limit || 10;
    try {
      const url = EVENTS_URL + "?select=id,event_type,payload,created_at" +
        "&order=created_at.desc&limit=" + encodeURIComponent(limit);
      const r = await fetch(url, { headers: baseHeaders() });
      if (!r.ok) return [];
      const rows = await r.json();
      return Array.isArray(rows) ? rows : [];
    } catch (e) {
      return [];
    }
  }

  /* ---- effect implementations (all no-ops if DOM pieces are missing) ---- */
  function _fxClearBanner() {
    _fxSafe(function () {
      var d = document.getElementById("arcade-event-banner");
      if (d && d.parentNode) d.parentNode.removeChild(d);
    });
  }
  function _fxBanner(msg) {
    _fxSafe(function () {
      _fxClearBanner();
      var d = document.createElement("div");
      d.id = "arcade-event-banner";
      d.textContent = "* " + String(msg == null ? "" : msg);
      d.setAttribute("style",
        "position:fixed;top:0;left:0;right:0;z-index:999999;" +
        "background:#000;border:3px solid #fff;" +
        "color:#fff;text-align:left;" +
        "padding:14px 18px;font-size:12px;line-height:1.8;" +
        "font-family:'Press Start 2P',monospace;");
      document.body.appendChild(d);
      setTimeout(_fxClearBanner, 30000);
    });
  }
  function _fxClearFog() {
    _fxSafe(function () {
      var d = document.getElementById("arcade-event-fog");
      if (d && d.parentNode) d.parentNode.removeChild(d);
    });
  }
  function _fxFog() {
    _fxSafe(function () {
      _fxClearFog();
      var d = document.createElement("div");
      d.id = "arcade-event-fog";
      d.setAttribute("style",
        "position:fixed;inset:0;z-index:999998;pointer-events:none;opacity:0;" +
        "transition:opacity 3s;" +
        "background:radial-gradient(ellipse at center," +
        " rgba(57,255,20,0.12) 0%, rgba(57,255,20,0.35) 70%," +
        " rgba(20,120,10,0.55) 100%);");
      document.body.appendChild(d);
      void d.offsetWidth; // force reflow so the fade-in transition runs
      d.style.opacity = "1";
      setTimeout(_fxClearFog, 30000);
    });
  }
  function _ensureShakeStyle() {
    if (document.getElementById("arcade-shake-style")) return;
    var s = document.createElement("style");
    s.id = "arcade-shake-style";
    s.textContent =
      "@keyframes arcade-shake{" +
      "0%,100%{transform:translate(0,0)}10%{transform:translate(-8px,4px)}" +
      "20%{transform:translate(7px,-5px)}30%{transform:translate(-6px,-4px)}" +
      "40%{transform:translate(6px,5px)}50%{transform:translate(-5px,3px)}" +
      "60%{transform:translate(5px,-3px)}70%{transform:translate(-4px,2px)}" +
      "80%{transform:translate(3px,-2px)}90%{transform:translate(-2px,1px)}}";
    document.head.appendChild(s);
  }
  function _fxShake() {
    _fxSafe(function () {
      _ensureShakeStyle();
      var b = document.body;
      b.style.animation = "arcade-shake .45s linear 6";
      setTimeout(function () {
        _fxSafe(function () { b.style.animation = ""; });
      }, 3000);
    });
  }
  function _fxInvert() {
    _fxSafe(function () {
      var el = document.documentElement;
      el.setAttribute("data-arcade-prev-filter", el.style.filter || "");
      el.style.filter = "invert(1) hue-rotate(180deg)";
      setTimeout(function () {
        _fxSafe(function () {
          el.style.filter = el.getAttribute("data-arcade-prev-filter") || "";
        });
      }, 10000);
    });
  }
  function _fxClearAll() {
    _fxClearBanner();
    _fxClearFog();
    _clearOverlay("arcade-event-matrix");
    _clearOverlay("arcade-event-snow");
    _clearOverlay("arcade-event-flashbang");
    _clearOverlay("arcade-event-spooky");
    _clearOverlay("arcade-event-cooldude");
    _fxSafe(function () {
      document.documentElement.style.filter = "";
      document.documentElement.style.animation = "";
      document.body.style.animation = "";
      try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) {}
    });
  }
  function _fxConfetti() {
    _fxSafe(function () {
      var c = document.createElement("canvas");
      c.setAttribute("style",
        "position:fixed;inset:0;z-index:999997;pointer-events:none;");
      document.body.appendChild(c);
      var ctx = c.getContext("2d");
      c.width = window.innerWidth || 800;
      c.height = window.innerHeight || 600;
      var colors = ["#ff2d95", "#00e5ff", "#ffe600", "#39ff14", "#ffffff", "#ff6b35"];
      var parts = [];
      for (var i = 0; i < 120; i++) {
        parts.push({
          x: Math.random() * c.width,
          y: -20 - Math.random() * c.height * 0.3,
          w: 5 + Math.random() * 7,
          h: 8 + Math.random() * 10,
          vy: 2 + Math.random() * 4,
          vx: -2 + Math.random() * 4,
          rot: Math.random() * Math.PI * 2,
          vr: -0.2 + Math.random() * 0.4,
          color: colors[(Math.random() * colors.length) | 0],
        });
      }
      var start = Date.now();
      (function frame() {
        var done = (Date.now() - start) > 6000 || !c.parentNode;
        if (done) {
          if (c.parentNode) c.parentNode.removeChild(c);
          return;
        }
        ctx.clearRect(0, 0, c.width, c.height);
        for (var j = 0; j < parts.length; j++) {
          var p = parts[j];
          p.x += p.vx; p.y += p.vy; p.rot += p.vr;
          if (p.y > c.height + 30) { p.y = -30; p.x = Math.random() * c.width; }
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
          ctx.restore();
        }
        requestAnimationFrame(frame);
      })();
    });
  }

  function _clearOverlay(id) {
    _fxSafe(function () {
      var d = document.getElementById(id);
      if (d && d.parentNode) d.parentNode.removeChild(d);
    });
  }
  function _fxMatrix() {
    _fxSafe(function () {
      _clearOverlay("arcade-event-matrix");
      var c = document.createElement("canvas");
      c.id = "arcade-event-matrix";
      c.setAttribute("style",
        "position:fixed;inset:0;z-index:999996;pointer-events:none;" +
        "opacity:1;transition:opacity 2s;");
      document.body.appendChild(c);
      var ctx = c.getContext("2d");
      c.width = window.innerWidth || 800;
      c.height = window.innerHeight || 600;
      var chars = "アカサタナハマヤラワ0123456789ABCDEF$#@%&";
      var fs = 16, cols = Math.ceil(c.width / fs), drops = [];
      for (var i = 0; i < cols; i++) drops.push(-Math.random() * 60);
      ctx.font = fs + "px monospace";
      var start = Date.now(), DUR = 10000; // 10s rain + 2s fade
      (function frame() {
        var elapsed = Date.now() - start;
        if (elapsed > DUR || !c.parentNode) {
          c.style.opacity = "0";
          setTimeout(function () { _clearOverlay("arcade-event-matrix"); }, 2100);
          return;
        }
        ctx.fillStyle = "rgba(0,0,0,0.08)";
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.fillStyle = "#39ff14";
        for (var j = 0; j < drops.length; j++) {
          var ch = chars[(Math.random() * chars.length) | 0];
          ctx.fillText(ch, j * fs, drops[j] * fs);
          if (drops[j] * fs > c.height && Math.random() > 0.975) drops[j] = 0;
          drops[j]++;
        }
        requestAnimationFrame(frame);
      })();
    });
  }
  function _ensureDiscoStyle() {
    if (document.getElementById("arcade-disco-style")) return;
    var s = document.createElement("style");
    s.id = "arcade-disco-style";
    s.textContent =
      "@keyframes arcade-disco{from{filter:hue-rotate(0deg)}" +
      "to{filter:hue-rotate(360deg)}}";
    document.head.appendChild(s);
  }
  function _fxDisco(ms) {
    _fxSafe(function () {
      _ensureDiscoStyle();
      var el = document.documentElement;
      el.style.animation = "arcade-disco 1.2s linear infinite";
      setTimeout(function () {
        _fxSafe(function () { el.style.animation = ""; });
      }, ms || 8000);
    });
  }
  function _fxFlashbang() {
    _fxSafe(function () {
      _clearOverlay("arcade-event-flashbang");
      var d = document.createElement("div");
      d.id = "arcade-event-flashbang";
      d.setAttribute("style",
        "position:fixed;inset:0;z-index:999994;pointer-events:none;" +
        "background:#fff;opacity:1;");
      document.body.appendChild(d);
      var pulses = [200, 400, 600, 800, 1000];
      pulses.forEach(function (t, i) {
        setTimeout(function () {
          _fxSafe(function () { d.style.opacity = (i % 2 === 0) ? "0.15" : "1"; });
        }, t);
      });
      setTimeout(function () { _clearOverlay("arcade-event-flashbang"); }, 1250);
    });
  }
  function _spookySting() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      var ctx = new AC(), t = ctx.currentTime;
      var o = ctx.createOscillator(); o.type = "sawtooth";
      o.frequency.setValueAtTime(420, t);
      o.frequency.exponentialRampToValueAtTime(55, t + 1.8);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.5, t + 0.08);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
      o.connect(g); g.connect(ctx.destination);
      o.start(t); o.stop(t + 2.4);
      var len = Math.floor(ctx.sampleRate * 0.5);
      var buf = ctx.createBuffer(1, len, ctx.sampleRate);
      var chd = buf.getChannelData(0);
      for (var i = 0; i < len; i++) chd[i] = (Math.random() * 2 - 1) * (1 - i / len);
      var s = ctx.createBufferSource(); s.buffer = buf;
      var ng = ctx.createGain(); ng.gain.value = 0.22;
      s.connect(ng); ng.connect(ctx.destination);
      s.start(t);
      setTimeout(function () { try { ctx.close(); } catch (e) {} }, 2600);
    } catch (e) { /* audio unavailable — the eyes still show */ }
  }
  function _fxSpooky() {
    _fxSafe(function () {
      _clearOverlay("arcade-event-spooky");
      var d = document.createElement("div");
      d.id = "arcade-event-spooky";
      d.setAttribute("style",
        "position:fixed;inset:0;z-index:999993;pointer-events:none;" +
        "background:#000;display:flex;align-items:center;justify-content:center;" +
        "gap:90px;opacity:1;transition:opacity .4s;");
      var eyeCss =
        "width:64px;height:88px;border-radius:50%;" +
        "background:radial-gradient(circle,#ff0000 0%,#ff2222 35%,rgba(255,0,0,0) 70%);" +
        "box-shadow:0 0 34px 12px rgba(255,0,0,.8);";
      var e1 = document.createElement("div");
      e1.setAttribute("style", eyeCss);
      var e2 = document.createElement("div");
      e2.setAttribute("style", eyeCss);
      d.appendChild(e1); d.appendChild(e2);
      document.body.appendChild(d);
      _spookySting();
      setTimeout(function () {
        _fxSafe(function () { d.style.opacity = "0"; });
        setTimeout(function () { _clearOverlay("arcade-event-spooky"); }, 450);
      }, 2100);
    });
  }
  function _fxParty() {
    _fxSafe(function () {
      _fxConfetti();
      _fxDisco(8000);
    });
  }
  function _fxCoolDude() {
    _fxSafe(function () {
      _clearOverlay("arcade-event-cooldude");
      // Resolve img/ relative to wherever this script was loaded from,
      // so it works from the hub (js/arcade.js) and games (../js/arcade.js).
      var base = "";
      var tag = document.querySelector('script[src$="js/arcade.js"]');
      if (tag) {
        var src = tag.getAttribute("src") || "";
        base = src.slice(0, src.length - "js/arcade.js".length);
      }
      if (!document.getElementById("arcade-cooldude-style")) {
        var st = document.createElement("style");
        st.id = "arcade-cooldude-style";
        st.textContent =
          "@keyframes arcadeCoolDude{" +
          "from{transform:translateY(0) rotate(-3deg) scale(1)}" +
          "to{transform:translateY(-26px) rotate(3deg) scale(1.05)}}";
        document.head.appendChild(st);
      }
      var d = document.createElement("div");
      d.id = "arcade-event-cooldude";
      d.setAttribute("style",
        "position:fixed;inset:0;z-index:999992;pointer-events:none;" +
        "display:flex;align-items:center;justify-content:center;" +
        "opacity:1;transition:opacity .4s;");
      var img = document.createElement("img");
      img.src = base + "img/cooldude.gif";
      img.alt = "COOL DUDE";
      img.setAttribute("style",
        "width:min(68vmin,480px);image-rendering:pixelated;" +
        "animation:arcadeCoolDude .9s ease-in-out infinite alternate;" +
        "filter:drop-shadow(0 0 24px rgba(255,255,255,.35));");
      d.appendChild(img);
      document.body.appendChild(d);
      setTimeout(function () {
        _fxSafe(function () { d.style.opacity = "0"; });
        setTimeout(function () { _clearOverlay("arcade-event-cooldude"); }, 450);
      }, 6000);
    });
  }
  function _fxSnow() {
    _fxSafe(function () {
      _clearOverlay("arcade-event-snow");
      var c = document.createElement("canvas");
      c.id = "arcade-event-snow";
      c.setAttribute("style",
        "position:fixed;inset:0;z-index:999995;pointer-events:none;");
      document.body.appendChild(c);
      var ctx = c.getContext("2d");
      c.width = window.innerWidth || 800;
      c.height = window.innerHeight || 600;
      var flakes = [];
      for (var i = 0; i < 150; i++) {
        flakes.push({
          x: Math.random() * c.width,
          y: Math.random() * c.height,
          r: 1 + Math.random() * 3,
          vy: 0.6 + Math.random() * 1.8,
          ph: Math.random() * Math.PI * 2,
          sw: 0.5 + Math.random() * 1.5,
        });
      }
      var start = Date.now(), DUR = 20000;
      (function frame() {
        if ((Date.now() - start) > DUR || !c.parentNode) {
          _clearOverlay("arcade-event-snow");
          return;
        }
        ctx.clearRect(0, 0, c.width, c.height);
        ctx.fillStyle = "rgba(255,255,255,.9)";
        for (var j = 0; j < flakes.length; j++) {
          var f = flakes[j];
          f.y += f.vy;
          f.ph += 0.02;
          f.x += Math.sin(f.ph) * f.sw * 0.4;
          if (f.y > c.height + 8) { f.y = -8; f.x = Math.random() * c.width; }
          ctx.beginPath();
          ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
          ctx.fill();
        }
        requestAnimationFrame(frame);
      })();
    });
  }
  function _fxTts(text) {
    _fxSafe(function () {
      var synth = window.speechSynthesis;
      if (!synth) return;
      try { synth.cancel(); } catch (e) {}
      var msg = String(text == null ? "" : text).slice(0, 200).trim();
      if (!msg) return;
      try {
        var u = new SpeechSynthesisUtterance(msg);
        u.rate = 1; u.pitch = 0.9;
        synth.speak(u);
      } catch (e) { /* unsupported */ }
    });
  }

  // Apply one event by type. Unknown types and missing DOM are no-ops.
  function applyEvent(type, payload) {
    _fxSafe(function () {
      if (window.ARCADE_NO_EVENTS || typeof document === "undefined") return;
      switch (String(type)) {
        case "banner": _fxBanner(payload); break;
        case "confetti": _fxConfetti(); break;
        case "shake": _fxShake(); break;
        case "invert": _fxInvert(); break;
        case "fog": _fxFog(); break;
        case "matrix": _fxMatrix(); break;
        case "disco": _fxDisco(); break;
        case "flashbang": _fxFlashbang(); break;
        case "spooky": _fxSpooky(); break;
        case "party": _fxParty(); break;
        case "snow": _fxSnow(); break;
        case "cooldude": _fxCoolDude(); break;
        case "tts": _fxTts(payload); break;
        case "clear": _fxClearAll(); break;
        default: break;
      }
    });
  }

  async function _pollEvents() {
    try {
      if (window.ARCADE_NO_EVENTS) return;
      const rows = await recentEvents(1);
      if (!rows.length) return;
      const ev = rows[0];
      if (!ev || !(ev.id > _lastSeenId())) return;
      _setLastSeenId(ev.id);
      const age = Date.now() - new Date(ev.created_at).getTime();
      if (isNaN(age) || age > 90000 || age < -60000) return; // stale or clock-skewed
      applyEvent(ev.event_type, ev.payload);
    } catch (e) { /* silent */ }
  }

  let _eventsStarted = false;
  function startEventListener() {
    if (_eventsStarted) return;
    _eventsStarted = true;
    _fxSafe(function () {
      if (window.ARCADE_NO_EVENTS || typeof document === "undefined") return;
      _pollEvents();
      setInterval(_pollEvents, 5000);
    });
  }

  // Auto-start once the DOM is ready.
  _fxSafe(function () {
    if (typeof document === "undefined") return;
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", startEventListener);
    } else {
      startEventListener();
    }
  });

  const eventsApi = {
    trigger: triggerEvent,
    recent: recentEvents,
    apply: applyEvent,
    start: startEventListener,
  };

  /* ================= Live chat widget =================
   * Toggleable site-wide chat. The admin flips site_settings.chat_enabled;
   * every arcade page polls it and shows a chat bubble while enabled.
   * Pages opt out with window.ARCADE_NO_CHAT=true. All user content is
   * rendered with textContent only (no innerHTML) — no XSS.
   */
  const SETTINGS_URL = SUPABASE_URL + "/rest/v1/site_settings";
  const CHAT_URL = SUPABASE_URL + "/rest/v1/chat_messages";
  const CHAT_SETTING_KEY = "chat_enabled";

  async function getChatEnabled() {
    try {
      const r = await fetch(
        SETTINGS_URL + "?key=eq." + CHAT_SETTING_KEY + "&select=value&limit=1",
        { headers: baseHeaders() });
      if (!r.ok) return false;
      const rows = await r.json();
      return !!(rows && rows[0] && String(rows[0].value).toLowerCase() === "true");
    } catch (e) { return false; }
  }

  // Upsert the chat_enabled setting. Resolves true on success.
  async function setChatEnabled(on) {
    try {
      const r = await fetch(SETTINGS_URL + "?on_conflict=key", {
        method: "POST",
        headers: Object.assign(baseHeaders(),
          { Prefer: "resolution=merge-duplicates,return=minimal" }),
        body: JSON.stringify({ key: CHAT_SETTING_KEY, value: on ? "true" : "false" }),
      });
      return r.ok;
    } catch (e) { return false; }
  }

  /* ---- Generic site_settings (permanent customizations: bg, title) ---- */
  // GET one setting value. Resolves null when missing/offline.
  async function getSetting(key) {
    try {
      const r = await fetch(
        SETTINGS_URL + "?key=eq." + encodeURIComponent(key) + "&select=value&limit=1",
        { headers: baseHeaders() });
      if (!r.ok) return null;
      const rows = await r.json();
      return (rows && rows[0]) ? rows[0].value : null;
    } catch (e) { return null; }
  }

  // GET several settings at once (lightweight keys only — never bg_image).
  // Resolves {} on failure.
  async function getSettings(keys) {
    try {
      const ors = keys.map(function (k) { return "key.eq." + k; }).join(",");
      const r = await fetch(
        SETTINGS_URL + "?or=(" + ors + ")&select=key,value",
        { headers: baseHeaders() });
      if (!r.ok) return {};
      const rows = await r.json();
      const out = {};
      if (Array.isArray(rows)) {
        for (var i = 0; i < rows.length; i++) out[rows[i].key] = rows[i].value;
      }
      return out;
    } catch (e) { return {}; }
  }

  // Upsert one setting. Resolves true on success.
  async function setSetting(key, value) {
    try {
      const r = await fetch(SETTINGS_URL + "?on_conflict=key", {
        method: "POST",
        headers: Object.assign(baseHeaders(),
          { Prefer: "resolution=merge-duplicates,return=minimal" }),
        body: JSON.stringify({ key: String(key), value: String(value) }),
      });
      return r.ok;
    } catch (e) { return false; }
  }

  /* ---- Permanent look: background image + custom hub title ---- */
  var _bgVersionCache = null;
  var _permWatchStarted = false;
  var PERM_KEYS = ["bg_enabled", "site_title", "bg_version"];
  var HUB_DEFAULT_TITLE = "* SANDBOX ARCADE";

  function _applyBg(dataUrl) {
    _fxSafe(function () {
      document.body.style.backgroundImage = 'url("' + dataUrl + '")';
      document.body.style.backgroundSize = "cover";
      document.body.style.backgroundAttachment = "fixed";
      document.body.style.backgroundPosition = "center";
    });
  }
  function _clearBg() {
    _fxSafe(function () { document.body.style.backgroundImage = ""; });
  }

  async function _permWatch() {
    try {
      var s = await getSettings(PERM_KEYS);
      var bgOn = String(s.bg_enabled || "").toLowerCase() === "true";
      if (!bgOn) {
        _bgVersionCache = null;
        _clearBg();
      } else if (s.bg_version && s.bg_version !== _bgVersionCache) {
        var img = await getSetting("bg_image");
        if (img) {
          _applyBg(img);
          _bgVersionCache = s.bg_version;
        }
      }
      // Custom hub title — index.html only (guarded by the game grid).
      _fxSafe(function () {
        if (!document.getElementById("grid")) return;
        var h1 = document.querySelector("header h1");
        if (!h1) return;
        var t = String(s.site_title || "").trim().slice(0, 60);
        h1.textContent = t ? "* " + t : HUB_DEFAULT_TITLE;
      });
    } catch (e) { /* silent */ }
  }

  function startPermWatcher() {
    if (_permWatchStarted) return;
    _permWatchStarted = true;
    _fxSafe(function () {
      if (typeof document === "undefined") return;
      _permWatch();
      setInterval(_permWatch, 10000);
    });
  }

  // POST one chat message. Resolves true on success, false on any failure.
  async function sendChatMessage(name, message) {
    try {
      const m = String(message == null ? "" : message).trim().slice(0, 200);
      if (!m) return false;
      const r = await fetch(CHAT_URL, {
        method: "POST",
        headers: Object.assign(baseHeaders(), { Prefer: "return=minimal" }),
        body: JSON.stringify({
          name: String(name || "anon").slice(0, 24),
          message: m,
        }),
      });
      return r.ok;
    } catch (e) { return false; }
  }

  // GET chat messages. sinceId>0 → newer-than (asc); else newest N (returned oldest-first).
  async function getChatMessages(sinceId, limit) {
    limit = limit || 30;
    try {
      let url;
      if (sinceId) {
        url = CHAT_URL + "?select=id,name,message,created_at&id=gt." +
          encodeURIComponent(sinceId) + "&order=id.asc&limit=50";
      } else {
        url = CHAT_URL + "?select=id,name,message,created_at&order=id.desc&limit=" +
          encodeURIComponent(limit);
      }
      const r = await fetch(url, { headers: baseHeaders() });
      if (!r.ok) return [];
      const rows = await r.json();
      if (!Array.isArray(rows)) return [];
      return sinceId ? rows : rows.reverse();
    } catch (e) { return []; }
  }

  // DELETE all chat messages. Resolves true on success.
  async function clearChatMessages() {
    try {
      const r = await fetch(CHAT_URL, { method: "DELETE", headers: baseHeaders() });
      return r.ok;
    } catch (e) { return false; }
  }

  var _chatBuilt = false, _chatOpen = false, _chatLastId = 0;
  var _chatBtn = null, _chatPanel = null, _chatList = null, _chatInput = null;
  var _chatMsgTimer = null, _chatWatchStarted = false;

  function _chatRemove() {
    _fxSafe(function () {
      if (_chatMsgTimer) { clearInterval(_chatMsgTimer); _chatMsgTimer = null; }
      if (_chatBtn && _chatBtn.parentNode) _chatBtn.parentNode.removeChild(_chatBtn);
      if (_chatPanel && _chatPanel.parentNode) _chatPanel.parentNode.removeChild(_chatPanel);
      _chatBtn = null; _chatPanel = null; _chatList = null; _chatInput = null;
      _chatBuilt = false; _chatOpen = false; _chatLastId = 0;
    });
  }

  function _chatOfflineNotice() {
    _fxSafe(function () {
      var d = document.createElement("div");
      d.textContent = "* chat is offline.";
      d.setAttribute("style",
        "position:fixed;left:16px;bottom:16px;z-index:999990;" +
        "background:#000;border:3px solid #fff;color:#fff;" +
        "padding:10px 18px;font-size:10px;line-height:1.8;" +
        "font-family:'Press Start 2P',monospace;" +
        "opacity:1;transition:opacity 1s;");
      document.body.appendChild(d);
      setTimeout(function () {
        _fxSafe(function () {
          d.style.opacity = "0";
          setTimeout(function () {
            _fxSafe(function () { if (d.parentNode) d.parentNode.removeChild(d); });
          }, 1100);
        });
      }, 1800);
    });
  }

  function _chatAddRow(name, message) {
    _fxSafe(function () {
      if (!_chatList) return;
      var div = document.createElement("div");
      div.setAttribute("style",
        "font-size:10px;line-height:1.8;word-wrap:break-word;" +
        "font-family:'Press Start 2P',monospace;");
      var n = document.createElement("strong");
      n.textContent = String(name) + ": ";
      n.setAttribute("style", "color:#ffff00;");
      var m = document.createElement("span");
      m.textContent = String(message);
      m.setAttribute("style", "color:#fff;");
      div.appendChild(n);
      div.appendChild(m);
      _chatList.appendChild(div);
      while (_chatList.children.length > 60) {
        _chatList.removeChild(_chatList.firstChild);
      }
      _chatList.scrollTop = _chatList.scrollHeight;
    });
  }

  function _chatPollMessages() {
    _fxSafe(function () {
      if (!_chatOpen) return;
      getChatMessages(_chatLastId).then(function (rows) {
        _fxSafe(function () {
          for (var i = 0; i < rows.length; i++) {
            _chatAddRow(rows[i].name, rows[i].message);
            if (rows[i].id > _chatLastId) _chatLastId = rows[i].id;
          }
        });
      });
    });
  }

  function _chatDoSend() {
    _fxSafe(function () {
      if (!_chatInput) return;
      var v = _chatInput.value;
      sendChatMessage(playerName(), v).then(function (ok) {
        _fxSafe(function () {
          if (ok && _chatInput) _chatInput.value = "";
        });
        _chatPollMessages();
      });
    });
  }

  function _chatToggle() {
    _fxSafe(function () {
      if (!_chatPanel) return;
      if (_chatOpen) {
        _chatOpen = false;
        _chatPanel.style.display = "none";
        if (_chatMsgTimer) { clearInterval(_chatMsgTimer); _chatMsgTimer = null; }
      } else {
        _chatOpen = true;
        _chatPanel.style.display = "flex";
        _chatLastId = 0;
        if (_chatList) _chatList.innerHTML = "";
        getChatMessages(0, 30).then(function (rows) {
          _fxSafe(function () {
            for (var i = 0; i < rows.length; i++) {
              _chatAddRow(rows[i].name, rows[i].message);
              if (rows[i].id > _chatLastId) _chatLastId = rows[i].id;
            }
          });
        });
        _chatMsgTimer = setInterval(_chatPollMessages, 3000);
        try { _chatInput.focus(); } catch (e) {}
      }
    });
  }

  function _chatBuild() {
    _fxSafe(function () {
      if (_chatBuilt || window.ARCADE_NO_CHAT) return;
      var btn = document.createElement("button");
      btn.id = "arcade-chat-btn";
      btn.textContent = "💬";
      btn.setAttribute("aria-label", "open chat");
      btn.setAttribute("style",
        "position:fixed;left:16px;bottom:16px;z-index:999990;" +
        "width:56px;height:56px;font-size:1.6rem;" +
        "background:#000;border:3px solid #fff;color:#fff;cursor:pointer;" +
        "font-family:'Press Start 2P',monospace;");
      btn.addEventListener("click", _chatToggle);

      var p = document.createElement("div");
      p.id = "arcade-chat-panel";
      p.setAttribute("style",
        "position:fixed;left:16px;bottom:84px;z-index:999991;" +
        "width:min(340px,calc(100vw - 32px));max-height:50vh;display:none;" +
        "flex-direction:column;background:#000;border:3px solid #fff;" +
        "overflow:hidden;" +
        "font-family:'Press Start 2P',monospace;");

      var h = document.createElement("div");
      h.textContent = "* arcade chat";
      h.setAttribute("style",
        "padding:10px 12px;color:#ffff00;font-size:10px;line-height:1.8;" +
        "border-bottom:3px solid #fff;" +
        "font-family:'Press Start 2P',monospace;");

      var list = document.createElement("div");
      list.setAttribute("style",
        "flex:1;overflow-y:auto;padding:10px 12px;display:flex;" +
        "flex-direction:column;gap:8px;min-height:120px;");

      var row = document.createElement("div");
      row.setAttribute("style",
        "display:flex;gap:8px;padding:10px;border-top:3px solid #fff;");

      var input = document.createElement("input");
      input.type = "text";
      input.maxLength = 200;
      input.placeholder = "say something…";
      input.setAttribute("style",
        "flex:1;background:#000;border:2px solid #fff;color:#fff;" +
        "padding:8px 10px;font-size:10px;line-height:1.6;" +
        "font-family:'Press Start 2P',monospace;");
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") _chatDoSend();
      });

      var send = document.createElement("button");
      send.textContent = "send";
      send.setAttribute("style",
        "background:#000;border:2px solid #fff;color:#fff;" +
        "padding:8px 14px;cursor:pointer;font-size:10px;" +
        "font-family:'Press Start 2P',monospace;");
      send.addEventListener("click", _chatDoSend);

      row.appendChild(input);
      row.appendChild(send);
      p.appendChild(h);
      p.appendChild(list);
      p.appendChild(row);
      document.body.appendChild(btn);
      document.body.appendChild(p);

      _chatBtn = btn; _chatPanel = p; _chatList = list; _chatInput = input;
      _chatBuilt = true;
    });
  }

  async function _chatWatch() {
    try {
      if (window.ARCADE_NO_CHAT) return;
      const on = await getChatEnabled();
      if (on && !_chatBuilt) {
        _chatBuild();
      } else if (!on && _chatBuilt) {
        const wasOpen = _chatOpen;
        _chatRemove();
        if (wasOpen) _chatOfflineNotice();
      }
    } catch (e) { /* silent */ }
  }

  function startChatWatcher() {
    if (_chatWatchStarted) return;
    _chatWatchStarted = true;
    _fxSafe(function () {
      if (window.ARCADE_NO_CHAT || typeof document === "undefined") return;
      _chatWatch();
      _storyWatch();
      setInterval(_chatWatch, 10000);
      setInterval(_storyWatch, 10000);
    });
  }

  /* ================= Fullscreen button (action games) =================
   * The 10 action games get a small ⛶ button (top-right) that toggles
   * document fullscreen. Pure client-side; games keep their own
   * layouts, this just hands them the whole screen. Joslyn's call
   * (Oct 20): fullscreen only makes sense for these — board/text
   * games are intentionally left out.
   */
  var FS_GAMES = ["fear-toxin.html", "snake.html", "tetris.html", "pong.html",
    "breakout.html", "flappy.html", "asteroids.html", "dodge.html",
    "whackamole.html", "reaction.html"];
  var _fsBtn = null, _fsStarted = false;

  function _fsActive() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement);
  }

  function _fsSyncBtn() {
    if (!_fsBtn) return;
    var on = _fsActive();
    _fsBtn.textContent = on ? "✕" : "⛶";
    _fsBtn.title = on ? "Exit fullscreen" : "Fullscreen";
    // Nudge games with window-resize handlers (e.g. Fear Toxin's 3D
    // renderer) to re-fit their stage to the new screen size.
    setTimeout(function () {
      try { window.dispatchEvent(new Event("resize")); } catch (e) { /* silent */ }
    }, 80);
  }

  function _fsToggle() {
    try {
      if (_fsActive()) {
        var exitFn = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
        if (exitFn) exitFn.call(document);
        return;
      }
      var el = document.documentElement;
      var req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
      if (!req) return;
      try {
        var p = req.call(el, { navigationUI: "hide" });
        if (p && typeof p.catch === "function") {
          p.catch(function () { try { req.call(el); } catch (e) { /* silent */ } });
        }
      } catch (e) {
        try { req.call(el); } catch (e2) { /* silent */ }
      }
    } catch (e) { /* silent */ }
  }

  function startFullscreenButton() {
    if (_fsStarted) return;
    _fsStarted = true;
    _fxSafe(function () {
      if (typeof document === "undefined" || window.ARCADE_NO_FULLSCREEN) return;
      var pageName = window.location.pathname.split("/").pop() || "";
      if (FS_GAMES.indexOf(pageName) === -1) return;
      var probe = document.documentElement;
      if (!(probe.requestFullscreen || probe.webkitRequestFullscreen || probe.msRequestFullscreen)) return;
      var b = document.createElement("button");
      b.id = "arcade-fs-btn";
      b.textContent = "⛶";
      b.title = "Fullscreen";
      b.setAttribute("aria-label", "Toggle fullscreen");
      b.setAttribute("style",
        "position:fixed;top:10px;right:10px;z-index:99999;width:42px;height:42px;" +
        "background:rgba(0,0,0,0.72);border:2px solid #fff;color:#fff;font-size:19px;" +
        "line-height:1;cursor:pointer;border-radius:6px;opacity:0.8;padding:0;");
      b.addEventListener("mouseenter", function () { b.style.opacity = "1"; });
      b.addEventListener("mouseleave", function () { b.style.opacity = "0.8"; });
      b.addEventListener("click", _fsToggle);
      document.body.appendChild(b);
      _fsBtn = b;
      document.addEventListener("fullscreenchange", _fsSyncBtn);
      document.addEventListener("webkitfullscreenchange", _fsSyncBtn);
      _fsSyncBtn();
    });
  }

  // Auto-start once the DOM is ready.
  _fxSafe(function () {
    if (typeof document === "undefined") return;
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () {
        startChatWatcher();
        startPermWatcher();
        startFullscreenButton();
      });
    } else {
      startChatWatcher();
      startPermWatcher();
      startFullscreenButton();
    }
  });

  const chatApi = {
    enabled: getChatEnabled,
    setEnabled: setChatEnabled,
    send: sendChatMessage,
    messages: getChatMessages,
    clear: clearChatMessages,
  };

  /* ================= Storyteller (TinyQuest AI in chat) =================
   * Admin flips site_settings.storyteller_enabled; when on, the chat panel
   * grows a 📖 button. Tapping it feeds recent chat as a story prompt to
   * /.netlify/functions/tinyquest and posts the AI's continuation as
   * "📖 TinyQuest". The model runs server-side — zero client download.
   */
  const STORY_SETTING_KEY = "storyteller_enabled";
  const STORY_FN_URL = "/.netlify/functions/tinyquest";
  const STORY_NAME = "📖 TinyQuest";
  var _storyBtn = null, _storyOn = false, _storyBusy = false;

  async function getStorytellerEnabled() {
    try {
      const v = await getSetting(STORY_SETTING_KEY);
      return String(v).toLowerCase() === "true";
    } catch (e) { return false; }
  }

  async function setStorytellerEnabled(on) {
    return setSetting(STORY_SETTING_KEY, on ? "true" : "false");
  }

  async function _storyGenerate(prompt) {
    try {
      const r = await fetch(STORY_FN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: String(prompt).slice(0, 400), max_chars: 150 }),
      });
      if (!r.ok) return null;
      const d = await r.json();
      return (d && d.text) ? String(d.text).trim() : null;
    } catch (e) { return null; }
  }

  var _storyStarters = [
    "You wake up in a dark dungeon. The door is open. ",
    "The old map showed an island no sailor had ever seen. ",
    "A dragon landed in the village square at dawn. ",
    "The haunted castle on the hill had been silent for a hundred years, until tonight. ",
    "You find a brass key buried under the oldest tree in the forest. ",
  ];

  async function _storyTell() {
    if (_storyBusy) return;
    _storyBusy = true;
    try {
      var prompt;
      const rows = await getChatMessages(0, 6);
      const bits = [];
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].name !== STORY_NAME && rows[i].message) bits.push(rows[i].message);
      }
      if (bits.length) {
        prompt = bits.slice(-3).join(" ").slice(-300) + " ";
      } else {
        prompt = _storyStarters[Math.floor(Math.random() * _storyStarters.length)];
      }
      _chatAddRow(STORY_NAME, "…dreaming…");
      const text = await _storyGenerate(prompt);
      await sendChatMessage(STORY_NAME, text || "The storyteller is silent right now. Try again soon.");
    } finally {
      _storyBusy = false;
      _chatPollMessages();
    }
  }

  function _storySyncButton() {
    _fxSafe(function () {
      if (!_chatPanel) return;
      if (_storyOn && !_storyBtn) {
        var b = document.createElement("button");
        b.textContent = "📖 story";
        b.setAttribute("style",
          "background:#000;border:2px solid #ffff00;color:#ffff00;" +
          "padding:8px 14px;cursor:pointer;font-size:10px;margin-left:8px;" +
          "font-family:'Press Start 2P',monospace;");
        b.addEventListener("click", _storyTell);
        var prow = _chatPanel.querySelector("div:last-child");
        if (prow) prow.appendChild(b);
        _storyBtn = b;
      } else if (!_storyOn && _storyBtn) {
        if (_storyBtn.parentNode) _storyBtn.parentNode.removeChild(_storyBtn);
        _storyBtn = null;
      }
    });
  }

  async function _storyWatch() {
    try {
      if (window.ARCADE_NO_CHAT || !_chatBuilt) return;
      _storyOn = await getStorytellerEnabled();
      _storySyncButton();
    } catch (e) { /* silent */ }
  }

  const settingsApi = {
    get: getSetting,
    getMany: getSettings,
    set: setSetting,
  };

  // Server-side admin password check (Joslyn's idea, 2026-10-21): the
  // guess goes to a Supabase RPC that answers only true/false; the stored
  // hash lives in a locked table no visitor can read, and the password
  // itself appears nowhere in the site's code. Resolves true/false, or
  // null when the checker could not be reached.
  async function checkAdminPassword(guess) {
    try {
      const r = await fetch(SUPABASE_URL + "/rest/v1/rpc/check_admin_password", {
        method: "POST",
        headers: baseHeaders(),
        body: JSON.stringify({ guess: String(guess == null ? "" : guess) }),
      });
      if (!r.ok) return null;
      const v = await r.json();
      return v === true;
    } catch (e) {
      return null;
    }
  }

  /* ================= Auto-update watcher =================
   * Joslyn's idea (2026-10-21): visitors shouldn't have to manually
   * refresh to receive site updates. Every page quietly polls the tiny
   * version.json against the build baked into this file. When a new
   * deploy lands: the hub reloads itself; in-game pages show a gold
   * "tap to update" bar instead, so a run is never force-interrupted.
   * IMPORTANT for future deploys: bump ARCADE_BUILD here AND version.json
   * to the same new value, or every open page will nag/reload forever.
   * Pages can opt out with window.ARCADE_NO_UPDATE=true.
   */
  const ARCADE_BUILD = "2026-10-21.6";
  let _updateHandled = false;

  function _siteBase() {
    try {
      var tag = document.querySelector('script[src$="js/arcade.js"]');
      if (tag) {
        var src = tag.getAttribute("src") || "";
        return src.slice(0, src.length - "js/arcade.js".length);
      }
    } catch (e) { /* no tag — use relative root */ }
    return "";
  }

  function _showUpdateBar() {
    _fxSafe(function () {
      if (document.getElementById("arcade-update-bar")) return;
      var bar = document.createElement("button");
      bar.id = "arcade-update-bar";
      bar.textContent = "* ✦ A NEWER ARCADE JUST DROPPED — TAP TO UPDATE";
      bar.setAttribute("style",
        "position:fixed;top:0;left:0;right:0;z-index:99999;background:#ffff00;" +
        "color:#000;border:0;border-bottom:3px solid #000;padding:12px 8px;" +
        "font-family:'Press Start 2P',monospace;font-size:10px;line-height:1.6;" +
        "cursor:pointer;text-align:center;width:100%;");
      bar.addEventListener("click", function () { location.reload(); });
      document.body.appendChild(bar);
    });
  }

  async function _checkForUpdate() {
    try {
      if (window.ARCADE_NO_UPDATE || _updateHandled) return;
      const r = await fetch(_siteBase() + "version.json?cb=" + Date.now(), { cache: "no-store" });
      if (!r.ok) return;
      const data = await r.json();
      if (!data || !data.build || data.build === ARCADE_BUILD) return;
      _updateHandled = true;
      const path = location.pathname || "";
      const isHub = path === "/" || /\/index\.html$/.test(path);
      if (isHub) {
        let already = null;
        try { already = sessionStorage.getItem("arcade_reloaded_for"); } catch (e) {}
        if (already !== data.build) {
          try { sessionStorage.setItem("arcade_reloaded_for", data.build); } catch (e) {}
          location.reload();
          return;
        }
      }
      _showUpdateBar();
    } catch (e) { /* offline or no version.json — stay silent */ }
  }

  _fxSafe(function () {
    if (typeof document === "undefined") return;
    const start = function () {
      _checkForUpdate();
      setInterval(_checkForUpdate, 45000);
      document.addEventListener("visibilitychange", function () {
        if (!document.hidden) _checkForUpdate();
      });
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", start);
    } else {
      start();
    }
  });

  return {
    build: ARCADE_BUILD,
    SUPABASE_URL: SUPABASE_URL,
    SUPABASE_ANON: SUPABASE_ANON,
    saveScore: saveScore,
    getScores: getScores,
    playerName: playerName,
    events: eventsApi,
    chat: chatApi,
    storyteller: {
      enabled: getStorytellerEnabled,
      setEnabled: setStorytellerEnabled,
      tell: _storyTell,
    },
    settings: settingsApi,
    checkAdmin: checkAdminPassword,
    fullscreen: { toggle: _fsToggle },
  };
})();
