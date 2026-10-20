/**
 * TinyQuest inference — Netlify Function. (build v4: nft bundler)
 * POST /.netlify/functions/tinyquest  { prompt, max_chars?, temp? }  ->  { text }
 * Runs our own Kaggle-trained ~14M char-level transformer (int8 ONNX) via onnxruntime.
 * No model download on the client; the arcade just calls this endpoint.
 */
const ort = require("onnxruntime-node");
const fs = require("fs");
const path = require("path");

const DIR = __dirname;
const MODEL_PATH = path.join(DIR, "tinyquest-int8.onnx");
const CONFIG_PATH = path.join(DIR, "quest_config.json");

let session = null;
let cfg = null;
let stoi = null, itos = null;

async function loadModel() {
  if (session) return;
  cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  const chars = cfg.chars;
  stoi = {};
  itos = {};
  chars.forEach((c, i) => { stoi[c] = i; itos[i] = c; });
  session = await ort.InferenceSession.create(MODEL_PATH, {
    executionProviders: ["cpu"],
    graphOptimizationLevel: "all",
  });
}

function encode(str, block) {
  const ids = [];
  for (const c of str) ids.push(stoi[c] !== undefined ? stoi[c] : 0);
  return ids.slice(-block);
}

function sample(logits, temp) {
  // logits: Float32Array over vocab; temperature sampling
  let max = -Infinity;
  for (let i = 0; i < logits.length; i++) if (logits[i] > max) max = logits[i];
  const exps = new Float64Array(logits.length);
  let sum = 0;
  for (let i = 0; i < logits.length; i++) { exps[i] = Math.exp((logits[i] - max) / temp); sum += exps[i]; }
  let r = Math.random() * sum;
  for (let i = 0; i < exps.length; i++) { r -= exps[i]; if (r <= 0) return i; }
  return exps.length - 1;
}

async function generate(prompt, maxChars, temp, timeBudgetMs) {
  const block = cfg.config.block;
  const CTX = Math.min(block, 96); // shorter window: ~30% faster per step, plenty for snippets
  let ids = encode(prompt, block).slice(-CTX);
  const out = [];
  const t0 = Date.now();
  for (let n = 0; n < maxChars; n++) {
    if (Date.now() - t0 > timeBudgetMs) break; // always answer before Netlify cuts us off
    const feeds = { input: new ort.Tensor("int64", BigInt64Array.from(ids.map(BigInt)), [1, ids.length]) };
    const results = await session.run(feeds);
    const logits = results.logits.data; // [1, T, V]
    const V = Object.keys(itos).length;
    const T = ids.length;
    const last = logits.subarray((T - 1) * V, T * V);
    const nextId = sample(last, temp);
    out.push(itos[nextId]);
    ids.push(nextId);
    if (ids.length > CTX) ids = ids.slice(-CTX);
    const ch = itos[nextId];
    if (ch === "\n" && out.length > 40 && Math.random() < 0.3) break; // natural-ish stop
  }
  return out.join("");
}

exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "POST only" }) };
  }
  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: "bad json" }) }; }

  const prompt = String(body.prompt || "").slice(0, 500);
  const maxChars = Math.min(Math.max(parseInt(body.max_chars) || 150, 20), 400);
  const temp = Math.min(Math.max(parseFloat(body.temp) || 0.8, 0.1), 1.5);
  if (!prompt) return { statusCode: 400, headers, body: JSON.stringify({ error: "prompt required" }) };

  try {
    await loadModel();
    const text = await generate(prompt, maxChars, temp, 20000);
    return { statusCode: 200, headers, body: JSON.stringify({ text }) };
  } catch (e) {
    console.error("tinyquest error:", e && e.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: "generation failed" }) };
  }
};
