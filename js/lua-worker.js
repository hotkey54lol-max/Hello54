/* Lua Lab sandbox worker.
 * Runs visitor Lua (Fengari) in a fresh VM per run. The VM is built with
 * ONLY safe libraries (base, coroutine, table, string, math, utf8) — os,
 * io, package and debug are never opened, and no JavaScript object is
 * ever pushed into the VM, so Lua code has no path to the page, the
 * arcade, or the network. Its only bridges are the ones defined here:
 * print() -> console, draw.* -> canvas commands, input() -> the console
 * input box, on_tick/on_key callbacks, and a read-only mouse table.
 * Runaway code is stopped two ways: a per-slice instruction budget
 * (debug count hook) and the host page's Stop button (worker.terminate).
 */
"use strict";

self.window = self; // the fengari-web UMD build attaches to `window`; in a worker that's `self`
importScripts("../lib/fengari.min.js");

var F = self.fengari;
var lua = F.lua, lauxlib = F.lauxlib, lualib = F.lualib;
var toL = F.to_luastring, toJS = F.to_jsstring;

var L = null;          // main lua state
var CO = null;         // coroutine thread running the visitor chunk
var tickTimer = null;
var drawBatch = [];
var runId = 0;
var tickStart = 0, lastTick = 0, cleanPosted = false;
var instrCount = 0, instrBudget = 0;

function post(o) { self.postMessage(o); }
function flushDraw() {
  if (drawBatch.length) { post({ t: "draw", calls: drawBatch }); drawBatch = []; }
}
function errText(Lstate) {
  var s = lua.lua_tostring(Lstate, -1);
  return s ? toJS(s) : "unknown error";
}

/* ---------- instruction budget (count hook) ---------- */
function hookFn(state) {
  instrCount++;
  if (instrCount > instrBudget) {
    lauxlib.luaL_error(state, toL("instruction budget blown — is that an infinite loop? the lab stopped this script."));
  }
}
function armBudget(state, budget) {
  instrCount = 0; instrBudget = budget;
  lua.lua_sethook(state, hookFn, lua.LUA_MASKCOUNT, 10000);
}
function disarmBudget(state) {
  lua.lua_sethook(state, null, 0, 0);
}

/* ---------- bridges ---------- */
function jsPrint(state) {
  var n = lua.lua_gettop(state), parts = [];
  for (var i = 1; i <= n; i++) {
    var s = lauxlib.luaL_tolstring(state, i, null);
    parts.push(s ? toJS(s) : "?");
    lua.lua_pop(state, 1);
  }
  post({ t: "print", text: parts.join("\t") });
  return 0;
}
function drawFn(name, nNums, hasStr) {
  return function (state) {
    var args = [];
    for (var i = 1; i <= nNums; i++) args.push(lua.lua_tonumber(state, i) || 0);
    if (hasStr) { var s = lua.lua_tostring(state, nNums + 1); args.push(s ? toJS(s) : ""); }
    drawBatch.push([name].concat(args));
    return 0;
  };
}

var BOOTSTRAP = [
  "dofile = nil",
  "loadfile = nil",
  "function input() return coroutine.yield('__lua_lab_input') end",
].join("\n");

function buildState() {
  L = lauxlib.luaL_newstate();
  var libs = [
    ["_G", lualib.luaopen_base],
    ["coroutine", lualib.luaopen_coroutine],
    ["table", lualib.luaopen_table],
    ["string", lualib.luaopen_string],
    ["math", lualib.luaopen_math],
    ["utf8", lualib.luaopen_utf8],
  ];
  for (var i = 0; i < libs.length; i++) {
    lauxlib.luaL_requiref(L, toL(libs[i][0]), libs[i][1], 1);
    lua.lua_pop(L, 1);
  }
  // print bridge
  lua.lua_pushjsfunction(L, jsPrint);
  lua.lua_setglobal(L, toL("print"));
  // draw table
  lua.lua_createtable(L, 0, 9);
  var fns = { clear: [0, 0], color: [3, 0], rect: [4, 0], circle: [3, 0], line: [4, 0], text: [1, 3] };
  // text(str, x, y): string first — handled specially below
  for (var name in fns) {
    if (name === "text") continue;
    lua.lua_pushjsfunction(L, drawFn(name, fns[name][0], false));
    lua.lua_setfield(L, -2, toL(name));
  }
  lua.lua_pushjsfunction(L, function (state) {
    var s = lua.lua_tostring(state, 1);
    drawBatch.push(["text", s ? toJS(s) : "", lua.lua_tonumber(state, 2) || 0, lua.lua_tonumber(state, 3) || 0]);
    return 0;
  });
  lua.lua_setfield(L, -2, toL("text"));
  lua.lua_pushnumber(L, 480); lua.lua_setfield(L, -2, toL("W"));
  lua.lua_pushnumber(L, 320); lua.lua_setfield(L, -2, toL("H"));
  lua.lua_setglobal(L, toL("draw"));
  // mouse table (read-only by convention; host updates fields)
  lua.lua_createtable(L, 0, 3);
  lua.lua_pushnumber(L, 0); lua.lua_setfield(L, -2, toL("x"));
  lua.lua_pushnumber(L, 0); lua.lua_setfield(L, -2, toL("y"));
  lua.lua_pushboolean(L, false); lua.lua_setfield(L, -2, toL("down"));
  lua.lua_setglobal(L, toL("mouse"));
  // bootstrap (input(), removed file loaders)
  if (lauxlib.luaL_dostring(L, toL(BOOTSTRAP)) !== lua.LUA_OK) {
    post({ t: "error", msg: "lab bootstrap failed: " + errText(L) });
  }
}

function stopTicks() {
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
}
function teardown() {
  stopTicks();
  if (L) { try { lua.lua_close(L); } catch (e) {} L = null; CO = null; }
}

function scriptError(msg) {
  stopTicks();
  flushDraw();
  post({ t: "error", msg: msg });
  post({ t: "state", state: "idle" });
}

function startTicks() {
  tickStart = Date.now(); lastTick = tickStart; cleanPosted = false;
  post({ t: "state", state: "ticking" });
  tickTimer = setInterval(function () {
    if (!L) return;
    var now = Date.now();
    var dt = Math.min(0.1, (now - lastTick) / 1000);
    lastTick = now;
    lua.lua_getglobal(L, toL("on_tick"));
    if (!lua.lua_isfunction(L, -1)) { lua.lua_pop(L, 1); stopTicks(); return; }
    lua.lua_pushnumber(L, dt);
    armBudget(L, 60); // 60 x 10k = 600k instructions per tick
    var st = lua.lua_pcall(L, 1, 0, 0);
    disarmBudget(L);
    if (st !== lua.LUA_OK) {
      var m = errText(L);
      lua.lua_pop(L, 1);
      scriptError(m);
      return;
    }
    flushDraw();
    if (!cleanPosted && now - tickStart >= 2000) {
      cleanPosted = true;
      post({ t: "clean" });
    }
  }, 33);
}

function resumeChunk(nargs) {
  armBudget(CO, 6000); // 60M instructions for the main chunk
  var st = lua.lua_resume(CO, L, nargs);
  disarmBudget(CO);
  if (st === lua.LUA_OK) {
    flushDraw();
    // chunk finished — does it want to keep living via on_tick?
    lua.lua_getglobal(L, toL("on_tick"));
    var hasTick = lua.lua_isfunction(L, -1);
    lua.lua_pop(L, 1);
    if (hasTick) startTicks();
    else post({ t: "state", state: "finished" });
  } else if (st === lua.LUA_YIELD) {
    var top = lua.lua_tostring(CO, -1);
    var what = top ? toJS(top) : "";
    lua.lua_pop(CO, 1);
    flushDraw();
    if (what === "__lua_lab_input") post({ t: "state", state: "waiting-input" });
    else resumeChunk(0); // a stray yield at top level: just keep going
  } else {
    scriptError(errText(CO));
  }
}

function run(code) {
  teardown();
  drawBatch = [];
  buildState();
  // host-side seed so math.random differs per run (scripts have no clock)
  lauxlib.luaL_dostring(L, toL("math.randomseed(" + ((Date.now() % 2147483646) + 1) + ")"));
  lua.lua_settop(L, 0);
  CO = lua.lua_newthread(L);
  var bytes = toL(String(code));
  var st = lauxlib.luaL_loadbufferx(CO, bytes, bytes.length, toL("@lua-lab"), null);
  if (st !== lua.LUA_OK) {
    scriptError(errText(CO));
    return;
  }
  post({ t: "state", state: "running" });
  resumeChunk(0);
}

self.onmessage = function (e) {
  var m = e.data || {};
  if (m.t === "run") { runId++; run(m.code); }
  else if (m.t === "stop") { teardown(); post({ t: "state", state: "idle" }); }
  else if (m.t === "input") {
    if (CO && L) {
      lua.lua_pushstring(CO, toL(String(m.text)));
      resumeChunk(1);
    }
  } else if (m.t === "key") {
    if (!L) return;
    lua.lua_getglobal(L, toL("on_key"));
    if (!lua.lua_isfunction(L, -1)) { lua.lua_pop(L, 1); return; }
    lua.lua_pushstring(L, toL(String(m.key)));
    armBudget(L, 60);
    var st = lua.lua_pcall(L, 1, 0, 0);
    disarmBudget(L);
    if (st !== lua.LUA_OK) { var em = errText(L); lua.lua_pop(L, 1); scriptError(em); }
    else flushDraw();
  } else if (m.t === "mouse") {
    if (!L) return;
    lua.lua_getglobal(L, toL("mouse"));
    if (!lua.lua_istable(L, -1)) { lua.lua_pop(L, 1); return; }
    lua.lua_pushnumber(L, Number(m.x) || 0); lua.lua_setfield(L, -2, toL("x"));
    lua.lua_pushnumber(L, Number(m.y) || 0); lua.lua_setfield(L, -2, toL("y"));
    lua.lua_pushboolean(L, !!m.down); lua.lua_setfield(L, -2, toL("down"));
    lua.lua_pop(L, 1);
  }
};

post({ t: "state", state: "idle" });
