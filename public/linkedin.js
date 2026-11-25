// Connect LinkedIn (via Composio OAuth). Shown in onboarding step 2 and in the sidebar.
const LI = { state: null, popup: null, poll: null };
const LI_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z"/></svg>`;

function paintLinkedIn() {
  const s = LI.state;
  const slots = [$("#li_onb"), $("#li_side")].filter(Boolean);
  let html = "";
  if (s && s.configured === false) {
    html = ""; // server isn't set up for LinkedIn connect: keep the PDF-only flow
  } else if (s?.connected) {
    const p = s.profile || {};
    const name = p.name || "LinkedIn account";
    const av = p.picture ? `<img src="${esc(p.picture)}" alt="" referrerpolicy="no-referrer">` : `<span class="liav">${esc(name.slice(0, 1))}</span>`;
    html = `${av}<span class="litxt"><b>${esc(name)}</b><small>LinkedIn connected ✓</small></span><button class="linkbtn" style="font-size:13px" onclick="disconnectLinkedIn()">Disconnect</button>`;
  } else if (s) {
    html = `<button class="libtn" id="li_btn" onclick="connectLinkedIn(this)">${LI_ICON}${s.pending ? "Finish connecting LinkedIn" : "Connect LinkedIn"}</button>`;
  }
  slots.forEach((el) => (el.innerHTML = html));
  document.querySelectorAll(".lior").forEach((el) => (el.hidden = !(s && s.configured !== false)));
}

async function loadLinkedIn() {
  try { LI.state = await call("/api/linkedin", { method: "GET" }); }
  catch (e) { LI.state = { configured: true, connected: false, error: e.message }; }
  paintLinkedIn();
  return LI.state;
}

async function connectLinkedIn(btn) {
  // Open the window inside the click so popup blockers allow it, then point it at Composio.
  const w = window.open("", "li_connect", "width=560,height=720");
  document.querySelectorAll(".libtn").forEach((b) => { b.disabled = true; b.lastChild.textContent = "Opening LinkedIn…"; });
  try {
    const { redirect_url } = await call("/api/linkedin/connect");
    if (w) { w.location.href = redirect_url; LI.popup = w; watchLinkedIn(); }
    else location.href = redirect_url; // popup blocked: full-page redirect, the callback brings us back
  } catch (e) {
    if (w) w.close();
    toast(e.message);
    paintLinkedIn();
  }
}

// Re-check while the popup is open, and once more when it closes.
function watchLinkedIn() {
  clearInterval(LI.poll);
  let n = 0;
  LI.poll = setInterval(async () => {
    n++;
    const closed = !LI.popup || LI.popup.closed;
    if (closed || n % 3 === 0) {
      const s = await loadLinkedIn();
      if (s.connected) { clearInterval(LI.poll); toast("LinkedIn connected"); }
      else if (closed || n > 300) { clearInterval(LI.poll); }
    }
  }, 1000);
}

window.addEventListener("message", (e) => {
  if (e.origin !== location.origin || e.data?.type !== "linkedin") return;
  loadLinkedIn().then((s) => { if (s.connected) toast("LinkedIn connected"); });
});

async function disconnectLinkedIn() {
  if (!confirm("Disconnect your LinkedIn account from Bulldog Reach?")) return;
  try { await call("/api/linkedin", { method: "DELETE" }); toast("LinkedIn disconnected"); }
  catch (e) { toast(e.message); }
  loadLinkedIn();
}

// Back from a full-page redirect (?linkedin=connected|failed): tidy the URL.
(function () {
  const q = new URLSearchParams(location.search);
  if (q.has("linkedin")) {
    if (q.get("linkedin") === "failed") toast("LinkedIn wasn't connected. Try again.");
    history.replaceState(null, "", location.pathname);
  }
})();
