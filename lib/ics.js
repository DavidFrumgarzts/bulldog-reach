// Build an iCalendar feed from cart items (deadlines + related events).
const esc = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/[,;]/g, (c) => "\\" + c);
const fold = (line) => {
  // RFC 5545: lines over 75 octets are folded with CRLF + space.
  const out = [];
  let s = line;
  while (Buffer.byteLength(s) > 74) {
    let n = 74;
    while (Buffer.byteLength(s.slice(0, n)) > 74) n--;
    out.push(s.slice(0, n));
    s = " " + s.slice(n);
  }
  out.push(s);
  return out.join("\r\n");
};
const ymd = (iso) => iso.replace(/-/g, "");
const nextDay = (iso) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10).replace(/-/g, ""); };
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");

// Every calendar-worthy event for one cart item.
function eventsFor(item) {
  const evs = [];
  const o = item.opp || {};
  if (isDate(o.deadline)) evs.push({ uid: `${item.id}-deadline`, title: `⏰ Apply: ${o.title} @ ${o.org}`, date: o.deadline, url: o.url, kind: "deadline", alarmDays: 3 });
  for (const [i, e] of (item.detail?.events || []).entries()) {
    if (!isDate(e.date)) continue;
    if (e.kind === "deadline" && isDate(o.deadline) && e.date === o.deadline) continue; // already added
<<<<<<< Updated upstream
    evs.push({ uid: `${item.id}-ev${i}`, title: `${e.kind === "deadline" ? "⏰" : "📍"} ${e.title}`, date: e.date, time: e.time, url: e.url, kind: e.kind, alarmDays: e.kind === "deadline" ? 3 : 1, note: e.verified ? "" : "Confirm this date on the official page." });
=======
    evs.push({ uid: `${item.id}-ev${i}`, title: `${e.kind === "deadline" ? "⏰" : "📍"} ${e.title}`, date: e.date, time: e.time, url: e.url, kind: e.kind, alarmDays: e.kind === "deadline" ? 3 : 1, note: "" });
>>>>>>> Stashed changes
  }
  return evs;
}

function ics(items, calName = "Bulldog Reach") {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Bulldog Reach//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${esc(calName)}`, "X-PUBLISHED-TTL:PT1H", "REFRESH-INTERVAL;VALUE=DURATION:PT1H"];
  for (const item of items) {
    if (item.status === "dropped") continue;
    for (const e of eventsFor(item)) {
      lines.push("BEGIN:VEVENT", `UID:${e.uid}@bulldogreach`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${ymd(e.date)}`, `DTEND;VALUE=DATE:${nextDay(e.date)}`,
        `SUMMARY:${esc(e.title)}`, `DESCRIPTION:${esc([e.time ? "Time: " + e.time : "", e.url || "", e.note || "", "— Bulldog Reach"].filter(Boolean).join("\n"))}`);
      if (e.url) lines.push(`URL:${e.url}`);
      lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(e.title)}`, `TRIGGER:-P${e.alarmDays}D`, "END:VALARM", "END:VEVENT");
    }
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

module.exports = { ics, eventsFor };
