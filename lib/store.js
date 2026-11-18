// Storage for cart items, calendar tokens, and resumes.
// Uses Supabase when the beta is configured; otherwise a local JSON file (dev only, gitignored).
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

module.exports = function makeStore({ AUTH, sb, root }) {
  const LOCAL_DB = path.join(root, "data", "local-db.json");
  const load = () => {
    try { return { cart: [], tokens: {}, resumes: {}, tailored: [], ...JSON.parse(fs.readFileSync(LOCAL_DB, "utf8")) }; }
    catch { return { cart: [], tokens: {}, resumes: {}, tailored: [] }; }
  };
  const save = (db) => { fs.mkdirSync(path.dirname(LOCAL_DB), { recursive: true }); fs.writeFileSync(LOCAL_DB, JSON.stringify(db, null, 1)); };
  const now = () => new Date().toISOString();
  const UUID = /^[0-9a-f-]{36}$/i;
  const key = (o) => `${String(o.title || "").trim().toLowerCase()}|${String(o.org || "").trim().toLowerCase()}`;

  // ---------- cart ----------
  async function cartList(uid) {
    if (AUTH) return sb(`cart_items?select=*&user_id=eq.${uid}&order=created_at.desc`);
    return load().cart.filter((i) => i.user_id === uid);
  }
  async function cartGet(uid, id) {
    if (!UUID.test(id)) return null;
    if (AUTH) return (await sb(`cart_items?select=*&id=eq.${id}&user_id=eq.${uid}`))[0] || null;
    return load().cart.find((i) => i.id === id && i.user_id === uid) || null;
  }
  async function cartAdd(uid, opp) {
    const existing = (await cartList(uid)).find((i) => key(i.opp) === key(opp));
    if (existing) return { item: existing, created: false };
    const item = { id: crypto.randomUUID(), user_id: uid, opp, detail: null, status: "saved", done: [], created_at: now(), updated_at: now() };
    if (AUTH) {
      const [row] = await sb("cart_items", { method: "POST", prefer: "return=representation", body: item });
      return { item: row, created: true };
    }
    const db = load(); db.cart.push(item); save(db);
    return { item, created: true };
  }
  async function cartUpdate(uid, id, patch) {
    if (!UUID.test(id)) return null;
    patch = { ...patch, updated_at: now() };
    if (AUTH) return (await sb(`cart_items?id=eq.${id}&user_id=eq.${uid}`, { method: "PATCH", prefer: "return=representation", body: patch }))[0] || null;
    const db = load();
    const it = db.cart.find((i) => i.id === id && i.user_id === uid);
    if (!it) return null;
    Object.assign(it, patch); save(db);
    return it;
  }
  async function cartRemove(uid, id) {
    if (!UUID.test(id)) return false;
    if (AUTH) { await sb(`cart_items?id=eq.${id}&user_id=eq.${uid}`, { method: "DELETE" }); return true; }
    const db = load(); db.cart = db.cart.filter((i) => !(i.id === id && i.user_id === uid)); save(db);
    return true;
  }

  // ---------- calendar feed tokens ----------
  async function calToken(uid) {
    if (AUTH) {
      const [row] = await sb(`cal_tokens?select=token&user_id=eq.${uid}`);
      if (row) return row.token;
      const token = crypto.randomBytes(18).toString("base64url");
      await sb("cal_tokens", { method: "POST", body: { user_id: uid, token } });
      return token;
    }
    const db = load();
    if (!db.tokens[uid]) { db.tokens[uid] = crypto.randomBytes(18).toString("base64url"); save(db); }
    return db.tokens[uid];
  }
  async function uidForToken(token) {
    if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) return null;
    if (AUTH) return (await sb(`cal_tokens?select=user_id&token=eq.${token}`))[0]?.user_id || null;
    return Object.entries(load().tokens).find(([, t]) => t === token)?.[0] || null;
  }

  // ---------- resumes ----------
  async function resumeGet(uid) {
    if (AUTH) return (await sb(`resumes?select=*&user_id=eq.${uid}`))[0] || null;
    return load().resumes[uid] || null;
  }
  async function resumeSave(uid, patch) {
    const row = { user_id: uid, ...patch, updated_at: now() };
    if (AUTH) return (await sb("resumes?on_conflict=user_id", { method: "POST", prefer: "resolution=merge-duplicates,return=representation", body: row }))[0];
    const db = load(); db.resumes[uid] = { ...(db.resumes[uid] || {}), ...row }; save(db);
    return db.resumes[uid];
  }
  async function tailoredGet(uid, cartId) {
    if (!UUID.test(cartId)) return null;
    if (AUTH) return (await sb(`tailored?select=*&user_id=eq.${uid}&cart_id=eq.${cartId}`))[0] || null;
    return load().tailored.find((t) => t.user_id === uid && t.cart_id === cartId) || null;
  }
  async function tailoredSave(uid, cartId, patch) {
    if (!UUID.test(cartId)) return null;
    const row = { user_id: uid, cart_id: cartId, ...patch, updated_at: now() };
    if (AUTH) return (await sb("tailored?on_conflict=user_id,cart_id", { method: "POST", prefer: "resolution=merge-duplicates,return=representation", body: row }))[0];
    const db = load();
    const i = db.tailored.findIndex((t) => t.user_id === uid && t.cart_id === cartId);
    if (i >= 0) db.tailored[i] = { ...db.tailored[i], ...row }; else db.tailored.push(row);
    save(db);
    return row;
  }

  // ---------- profile (onboarding answers) ----------
  async function profileGet(uid) {
    if (AUTH) return (await sb(`profiles?select=data&user_id=eq.${uid}`))[0]?.data || null;
    return load().profiles?.[uid] || null;
  }
  async function profileSave(uid, data) {
    if (AUTH) { await sb("profiles?on_conflict=user_id", { method: "POST", prefer: "resolution=merge-duplicates", body: { user_id: uid, data, updated_at: now() } }); return data; }
    const db = load(); db.profiles = db.profiles || {}; db.profiles[uid] = data; save(db);
    return data;
  }

  return { cartList, cartGet, cartAdd, cartUpdate, cartRemove, calToken, uidForToken, resumeGet, resumeSave, tailoredGet, tailoredSave, profileGet, profileSave };
};
