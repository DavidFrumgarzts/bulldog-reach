// Boot Outreach records: one generic, per-user store for the workspace entities
// (profile, claims, saved searches, opportunities, applications, contacts, outreach, answers, search runs).
// Supabase table `boot_records` when the beta is configured; otherwise data/boot-db.json (dev only, gitignored).
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const KINDS = ["profile", "claim", "search", "run", "opp", "app", "contact", "outreach", "answer"];

module.exports = function makeRecords({ AUTH, sb, root }) {
  const FILE = path.join(root, "data", "boot-db.json");
  let cache = null;
  const load = () => {
    if (cache) return cache;
    try { cache = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { cache = { rows: [] }; }
    return cache;
  };
  const save = () => { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(cache)); };
  const now = () => new Date().toISOString();
  const okKind = (k) => { if (!KINDS.includes(k)) throw new Error("bad kind " + k); return k; };
  const enc = encodeURIComponent;

  async function list(uid, kind) {
    okKind(kind);
    if (AUTH) return (await sb(`boot_records?select=id,data,created_at,updated_at&user_id=eq.${enc(uid)}&kind=eq.${kind}&order=updated_at.desc&limit=2000`)).map(unpack);
    return load().rows.filter((r) => r.user_id === uid && r.kind === kind).sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1)).map(unpack);
  }
  async function get(uid, kind, id) {
    okKind(kind);
    if (AUTH) return (await sb(`boot_records?select=id,data,created_at,updated_at&user_id=eq.${enc(uid)}&kind=eq.${kind}&id=eq.${enc(id)}`)).map(unpack)[0] || null;
    const r = load().rows.find((x) => x.user_id === uid && x.kind === kind && x.id === id);
    return r ? unpack(r) : null;
  }
  // Writes the whole record (id, created_at and updated_at are managed here).
  async function put(uid, kind, rec) {
    okKind(kind);
    const id = String(rec.id || crypto.randomUUID());
    const { id: _i, created_at: _c, updated_at: _u, ...data } = rec;
    const row = { user_id: uid, kind, id, data, updated_at: now() };
    if (AUTH) {
      const [out] = await sb("boot_records?on_conflict=user_id,kind,id", { method: "POST", prefer: "resolution=merge-duplicates,return=representation", body: row });
      return unpack(out);
    }
    const db = load();
    const i = db.rows.findIndex((x) => x.user_id === uid && x.kind === kind && x.id === id);
    if (i >= 0) db.rows[i] = { ...db.rows[i], ...row }; else db.rows.push({ ...row, created_at: now() });
    save();
    return unpack(db.rows[i >= 0 ? i : db.rows.length - 1]);
  }
  async function patch(uid, kind, id, fn) {
    const cur = await get(uid, kind, id);
    if (!cur) return null;
    return put(uid, kind, fn(cur) || cur);
  }
  async function remove(uid, kind, id) {
    okKind(kind);
    if (AUTH) { await sb(`boot_records?user_id=eq.${enc(uid)}&kind=eq.${kind}&id=eq.${enc(id)}`, { method: "DELETE" }); return true; }
    const db = load(); db.rows = db.rows.filter((x) => !(x.user_id === uid && x.kind === kind && x.id === id)); save();
    return true;
  }
  async function exportAll(uid) {
    const out = {};
    for (const k of KINDS) out[k] = await list(uid, k);
    return out;
  }
  async function deleteAll(uid) {
    if (AUTH) { await sb(`boot_records?user_id=eq.${enc(uid)}`, { method: "DELETE" }); return true; }
    const db = load(); db.rows = db.rows.filter((x) => x.user_id !== uid); save();
    return true;
  }
  function unpack(r) { return { ...r.data, id: r.id, created_at: r.created_at, updated_at: r.updated_at }; }

  return { KINDS, list, get, put, patch, remove, exportAll, deleteAll };
};
