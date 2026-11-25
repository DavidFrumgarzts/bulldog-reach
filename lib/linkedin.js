// LinkedIn via Composio (https://docs.composio.dev). Composio runs the OAuth flow and stores the tokens,
// keyed by our user id, so we keep no LinkedIn credentials ourselves.
// Setup: create a LinkedIn auth config in the Composio dashboard, then set COMPOSIO_API_KEY and
// COMPOSIO_LINKEDIN_AUTH_CONFIG_ID in .env.
const BASE = (process.env.COMPOSIO_BASE_URL || "https://backend.composio.dev/api/v3.1").replace(/\/$/, "");
const KEY = process.env.COMPOSIO_API_KEY || "";
const AUTH_CONFIG = process.env.COMPOSIO_LINKEDIN_AUTH_CONFIG_ID || "";
const configured = !!(KEY && AUTH_CONFIG);

class ComposioError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

async function api(pathq, { method = "GET", body } = {}) {
  const r = await fetch(BASE + pathq, {
    method,
    headers: { "x-api-key": KEY, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  let d = null;
  try { d = t ? JSON.parse(t) : null; } catch { d = { raw: t }; }
  if (!r.ok) {
    const msg = d?.error?.message || d?.message || t.slice(0, 200);
    throw new ComposioError(502, `LinkedIn connection service error (${r.status}): ${msg}`);
  }
  return d;
}

// Composio user ids are free-form strings; namespace ours so they never collide with other apps on the project.
const cid = (uid) => "bulldog:" + uid;

async function accounts(uid) {
  const q = new URLSearchParams({ "user_ids": cid(uid), "toolkit_slugs": "linkedin", order_by: "created_at", order_direction: "desc", limit: "10" });
  const d = await api(`/connected_accounts?${q}`);
  return (d?.items || []).filter((a) => !AUTH_CONFIG || a.auth_config?.id === AUTH_CONFIG);
}

async function execute(uid, accountId, tool, args = {}) {
  const d = await api(`/tools/execute/${tool}`, { method: "POST", body: { connected_account_id: accountId, user_id: cid(uid), version: "latest", arguments: args } });
  if (!d?.successful) throw new ComposioError(502, `LinkedIn ${tool} failed: ${d?.error || "unknown error"}`);
  return d.data;
}

// LinkedIn's OpenID userinfo shape (name, given_name, picture, email, sub, locale), sometimes nested.
function normalizeProfile(raw = {}) {
  const p = raw.response_dict || raw.data || raw;
  const name = p.name || [p.given_name || p.localizedFirstName, p.family_name || p.localizedLastName].filter(Boolean).join(" ");
  return {
    name: String(name || "").slice(0, 120),
    email: String(p.email || "").slice(0, 200),
    picture: /^https:\/\//.test(p.picture || "") ? p.picture : "",
    headline: String(p.headline || p.localizedHeadline || "").slice(0, 200),
    sub: String(p.sub || p.id || "").slice(0, 80),
  };
}

const profileCache = new Map(); // accountId → { profile, exp }
async function profile(uid, accountId) {
  const hit = profileCache.get(accountId);
  if (hit && hit.exp > Date.now()) return hit.profile;
  const p = normalizeProfile(await execute(uid, accountId, "LINKEDIN_GET_MY_INFO"));
  profileCache.set(accountId, { profile: p, exp: Date.now() + 10 * 60e3 });
  return p;
}

async function status(uid) {
  if (!configured) return { configured: false, connected: false };
  const list = await accounts(uid);
  const active = list.find((a) => a.status === "ACTIVE");
  if (!active) return { configured: true, connected: false, pending: list.some((a) => ["INITIATED", "INITIALIZING"].includes(a.status)) };
  let me = null;
  try { me = await profile(uid, active.id); } catch (e) { console.error(e.message); }
  return { configured: true, connected: true, account_id: active.id, profile: me };
}

async function connect(uid, callbackUrl) {
  if (!configured) throw new ComposioError(503, "LinkedIn connect isn't set up on this server yet (missing COMPOSIO_API_KEY / COMPOSIO_LINKEDIN_AUTH_CONFIG_ID).");
  const d = await api("/connected_accounts/link", { method: "POST", body: { auth_config_id: AUTH_CONFIG, user_id: cid(uid), callback_url: callbackUrl } });
  if (!d?.redirect_url) throw new ComposioError(502, "LinkedIn connection service returned no link.");
  return { redirect_url: d.redirect_url, connected_account_id: d.connected_account_id };
}

async function disconnect(uid) {
  if (!configured) return { ok: true };
  for (const a of await accounts(uid)) {
    await api(`/connected_accounts/${encodeURIComponent(a.id)}`, { method: "DELETE" });
    profileCache.delete(a.id);
  }
  return { ok: true };
}

// Page Composio sends the browser back to. It carries no auth, so it only tells the opener to re-check;
// the opener then asks /api/linkedin, which looks up connections by the signed-in user's id.
function callbackPage(ok) {
  return `<!doctype html><meta charset="utf-8"><title>LinkedIn</title>
<body style="font:16px system-ui;background:#1b1410;color:#fff;display:grid;place-items:center;height:100vh;margin:0">
<p>${ok ? "LinkedIn connected. You can close this window." : "LinkedIn wasn't connected. You can close this window and try again."}</p>
<script>
  var back = function () { location.replace("/app?linkedin=${ok ? "connected" : "failed"}"); };
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ type: "linkedin", ok: ${ok ? "true" : "false"} }, location.origin);
      setTimeout(function () { window.close(); setTimeout(back, 300); }, 600);
    } else back();
  } catch (e) { back(); }
</script></body>`;
}

module.exports = { configured, status, connect, disconnect, callbackPage, ComposioError };
