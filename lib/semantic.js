// Meaning-based matching, free and local: a small sentence-embedding model (all-MiniLM-L6-v2, ~23 MB)
// runs on this machine through transformers.js. No API key, no account, no per-use cost.
// The model downloads once from Hugging Face on first use and is cached under node_modules.
// If it can't load (e.g. offline on first run), callers fall back to keyword matching and say so.
const crypto = require("crypto");

const MODEL = process.env.EMBED_MODEL || "Xenova/all-MiniLM-L6-v2";
let extractor = null, loading = null, failed = null;
const cache = new Map(); // sha1(text) → Float32Array (normalized)
const MAX_CACHE = 20000;

async function load() {
  if (extractor) return extractor;
  if (failed) throw failed;
  loading ||= (async () => {
    try {
      const { pipeline } = await import("@huggingface/transformers");
      extractor = await pipeline("feature-extraction", MODEL, { dtype: "q8" });
      return extractor;
    } catch (e) { failed = new Error("Meaning model unavailable: " + e.message); throw failed; }
  })();
  return loading;
}
const key = (t) => crypto.createHash("sha1").update(t).digest("base64");
const clean = (t) => String(t || "").replace(/\s+/g, " ").trim().slice(0, 1200);

async function embed(texts) {
  const ex = await load();
  const list = texts.map(clean);
  const missing = [...new Set(list.filter((t) => t && !cache.has(key(t))))];
  for (let i = 0; i < missing.length; i += 32) {
    const batch = missing.slice(i, i + 32);
    const out = await ex(batch, { pooling: "mean", normalize: true });
    const dim = out.dims[out.dims.length - 1];
    batch.forEach((t, j) => cache.set(key(t), Float32Array.from(out.data.subarray(j * dim, (j + 1) * dim))));
  }
  if (cache.size > MAX_CACHE) for (const k of [...cache.keys()].slice(0, cache.size - MAX_CACHE)) cache.delete(k);
  return list.map((t) => (t ? cache.get(key(t)) : null));
}
const cos = (a, b) => { if (!a || !b) return 0; let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

// Map raw cosine similarity (MiniLM: unrelated ≈ 0.1–0.25, related ≈ 0.4–0.6) to a 0–100 score.
const toScore = (sim, lo = 0.18, hi = 0.55) => Math.max(0, Math.min(100, Math.round(((sim - lo) / (hi - lo)) * 100)));

const available = () => !!extractor;
const status = () => (extractor ? "ready" : failed ? failed.message : loading ? "loading" : "not loaded");
// Start loading in the background so the first search isn't slow.
function warm() { load().catch((e) => console.error(e.message)); }

module.exports = { embed, cos, toScore, available, status, warm, MODEL };
