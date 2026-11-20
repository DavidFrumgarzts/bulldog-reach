// Yale NetID sign-in through Yale CAS (the login CourseTable and Canvas use).
// No email is sent: Yale confirms the student's NetID, then we open a Supabase session for them.
// Off until Yale ITS registers this service: set CAS_ENABLED=1 after approval.
module.exports = function makeCas({ AUTH, SB_URL, SB_SERVICE, DOMAIN, publicBase }) {
  const CAS = (process.env.CAS_URL || "https://secure.its.yale.edu/cas").replace(/\/$/, "");
  const enabled = AUTH && process.env.CAS_ENABLED === "1";
  const serviceUrl = (req) => `${publicBase(req)}/auth/cas/callback`;
  const adminHeaders = () => ({
    apikey: SB_SERVICE,
    ...(SB_SERVICE.startsWith("sb_") ? {} : { Authorization: `Bearer ${SB_SERVICE}` }),
    "Content-Type": "application/json",
  });
  const tag = (xml, name) => (xml.match(new RegExp(`<cas:${name}>\\s*([^<]+?)\\s*</cas:${name}>`)) || [])[1] || "";

  // Ask Yale whether this one-time ticket is real, and for whom.
  async function validate(req, ticket) {
    const url = `${CAS}/p3/serviceValidate?service=${encodeURIComponent(serviceUrl(req))}&ticket=${encodeURIComponent(ticket)}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const xml = await r.text();
    if (!xml.includes("<cas:authenticationSuccess>")) throw new Error("Yale didn't confirm the sign-in. Please try again.");
    const netid = tag(xml, "user").toLowerCase();
    if (!/^[a-z0-9]{2,16}$/.test(netid)) throw new Error("Yale returned an unexpected NetID.");
    const mail = (tag(xml, "mail") || tag(xml, "email")).toLowerCase();
    return { netid, mail };
  }

  // Create the account if it's new, then get a one-time sign-in token for it (no email sent).
  async function oneTimeToken(email, netid) {
    await fetch(`${SB_URL}/auth/v1/admin/users`, {
      method: "POST", headers: adminHeaders(),
      body: JSON.stringify({ email, email_confirm: true, user_metadata: { netid } }),
    }); // "already registered" is fine
    const r = await fetch(`${SB_URL}/auth/v1/admin/generate_link`, {
      method: "POST", headers: adminHeaders(), body: JSON.stringify({ type: "magiclink", email }),
    });
    const d = await r.json().catch(() => ({}));
    const token = d.properties?.hashed_token || d.hashed_token;
    if (!token) throw new Error("Couldn't start your session. Please try again.");
    return token;
  }

  const redirect = (res, to) => { res.writeHead(302, { Location: to, "Cache-Control": "no-store" }); res.end(); };
  const fail = (res, msg) => redirect(res, "/app?login_error=" + encodeURIComponent(msg));

  // Returns true if it handled the request.
  async function handle(req, res, url) {
    if (url !== "/auth/cas" && url !== "/auth/cas/callback") return false;
    if (!enabled) { fail(res, "Yale NetID sign-in isn't switched on yet. Use your email for now."); return true; }
    if (url === "/auth/cas") { redirect(res, `${CAS}/login?service=${encodeURIComponent(serviceUrl(req))}`); return true; }
    const ticket = new URL(req.url, "http://x").searchParams.get("ticket") || "";
    if (!/^ST-[\w.-]{8,256}$/.test(ticket)) { fail(res, "Sign-in was cancelled or expired."); return true; }
    try {
      const { netid, mail } = await validate(req, ticket);
      // Prefer the real Yale address Yale sends; otherwise fall back to netid@yale.edu as the account key.
      const email = mail && (mail.endsWith("@" + DOMAIN) || mail.endsWith("." + DOMAIN)) ? mail : `${netid}@${DOMAIN}`;
      const token = await oneTimeToken(email, netid);
      redirect(res, `/auth/confirm?token_hash=${encodeURIComponent(token)}&type=email`);
    } catch (e) {
      console.error("CAS sign-in failed:", e.message);
      fail(res, e.message);
    }
    return true;
  }

  return { enabled, handle };
};
