"use strict";
/* ---------- anti-clickjacking: refuse to run inside a frame ---------- */
if (window.top !== window.self) {
  try { window.top.location = window.self.location.href; } catch (e) { /* cross-origin frame */ }
  throw new Error("framed");
}
document.getElementById("antiClickjack")?.remove();
/* ---------- App Check (reCAPTCHA Enterprise). Public site key; empty = not activated yet ---------- */
const APP_CHECK_SITE_KEY = "";
/* ---------- Firebase project config (public values, safe to commit) ---------- */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDEA8dSmflCXIGOfEe1zpNJoKjsFgHpYjI",
  authDomain: "matsevet.firebaseapp.com",
  projectId: "matsevet",
  storageBucket: "matsevet.firebasestorage.app",
  messagingSenderId: "834040582684",
  appId: "1:834040582684:web:001fa59a2a410ee17745d9"
};
/* ---------- constants ---------- */
const TYPES = { home: "בבית", course: "קורס", nir: "לא במילואים" };
const TYPE_CLS = { home: "c-home", course: "c-course", nir: "c-nir" };
const PRIORITY = { nir: 3, course: 2, home: 1 };
const REASONS = ["יציאה", "מחלה", "אישי", "לימודים", "אחר"];
const DOW = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];
const DOW_LONG = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];

/* ---------- state ---------- */
const S = {
  team: null, soldiers: [], absences: [], settings: { reserveDays: [], minStrength: 15 }, lastBackup: null,
  tab: "cal", day: null, soldier: null, sort: "out",
  notice: "", cache: null, copyText: null,
  wiz: null, pick: null, backupCode: null, restore: null, restoreErr: "", resetStep: 0,
  auth: "loading", user: null, cloudReady: false, loginErr: "", localFound: null
};

/* ---------- date helpers (all local time) ---------- */
const pad = n => String(n).padStart(2, "0");
const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function dOf(key) { const [y, m, d] = key.split("-").map(Number); return new Date(y, m - 1, d); }
function addDays(key, n) { const d = dOf(key); d.setDate(d.getDate() + n); return keyOf(d); }
function ms(s) { const [d, t = "00:00"] = s.split("T"); const [h, mi] = t.split(":").map(Number); const x = dOf(d); x.setHours(h, mi, 0, 0); return x.getTime(); }
const short = key => { const d = dOf(key); return `${d.getDate()}.${d.getMonth() + 1}`; };
const longDate = key => { const d = dOf(key); return `יום ${DOW_LONG[d.getDay()]}, ${d.getDate()} ב${MONTHS[d.getMonth()]}`; };
const hm = t => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const todayKey = () => keyOf(new Date());
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ltr = s => "\u2066" + s + "\u2069";
const span2 = (a, b) => ltr(`${a}–${b}`);
const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/* ---------- derived data ---------- */
function settings() { return S.settings; }
function activeSoldiers() { return S.soldiers.filter(s => s.active !== false); }
function reserveDays() { return [...new Set(S.settings.reserveDays || [])].sort(); }
function statusCls(n) { const m = Number(settings().minStrength) || 0; return n < m ? "bad" : n === m ? "warn" : "ok"; }

function dayInfo(key) {
  const s0 = ms(key), s1 = ms(addDays(key, 1));
  const per = activeSoldiers().map(sol => {
    const abs = S.absences.filter(a => a.soldierId === sol.id && ms(a.start) < s1 && ms(a.end) > s0);
    const full = abs.filter(a => ms(a.start) <= s0 && ms(a.end) >= s1).sort((a, b) => PRIORITY[b.type] - PRIORITY[a.type])[0] || null;
    return { sol, full, partial: full ? [] : abs };
  });
  const pts = new Set([s0, s1]);
  per.forEach(p => p.partial.forEach(a => { pts.add(Math.max(s0, ms(a.start))); pts.add(Math.min(s1, ms(a.end))); }));
  const sorted = [...pts].sort((a, b) => a - b);
  const segs = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const t = sorted[i];
    const n = per.filter(p => !p.full && !p.partial.some(a => ms(a.start) <= t && ms(a.end) > t)).length;
    const last = segs[segs.length - 1];
    if (last && last.n === n) last.t1 = sorted[i + 1]; else segs.push({ t0: t, t1: sorted[i + 1], n });
  }
  const min = segs.length ? Math.min(...segs.map(s => s.n)) : per.length;
  return { key, s0, s1, per, segs, min, total: per.length, hasPartial: per.some(p => p.partial.length) };
}
function cache() {
  if (!S.cache) { const days = reserveDays(); S.cache = { days, info: new Map(days.map(k => [k, dayInfo(k)])) }; }
  return S.cache;
}
function presentNow() {
  const k = todayKey(); const info = cache().info.get(k); if (!info) return null;
  const t = Date.now();
  const n = info.per.filter(p => !p.full && !p.partial.some(a => ms(a.start) <= t && ms(a.end) > t)).length;
  return { n, total: info.total };
}
function soldierStats(id) {
  const st = { home: 0, course: 0, nir: 0, partial: 0, present: 0 };
  for (const info of cache().info.values()) {
    const p = info.per.find(x => x.sol.id === id); if (!p) continue;
    if (p.full) st[p.full.type]++; else { st.present++; if (p.partial.length) st.partial++; }
  }
  return st;
}
function absRangeText(a) {
  if (a.allDay) { const from = a.start.slice(0, 10), to = addDays(a.end.slice(0, 10), -1); return from === to ? short(from) : span2(short(from), short(to)); }
  const f = a.start.slice(0, 10), t = a.end.slice(0, 10);
  return f === t ? `${short(f)} · ${span2(a.start.slice(11), a.end.slice(11))}` : `${ltr(short(f) + " " + a.start.slice(11))} עד ${ltr(short(t) + " " + a.end.slice(11))}`;
}
function absDays(a) { let n = 0; for (const k of cache().days) { if (ms(a.start) <= ms(k) && ms(a.end) >= ms(addDays(k, 1))) n++; } return n; }
const nameOf = id => (S.soldiers.find(s => s.id === id) || {}).name || "לוחם שהוסר";
const reasonText = a => a.type === "home" ? [a.reason, a.note].filter(Boolean).join(" · ") : (a.note || "");

function reportTitleSuffix() { return S.team ? ` – ${S.team.name}` : ""; }
function reportTimes() { const t = (S.settings.reportTimes || []).filter(x => /^\d{2}:\d{2}$/.test(x)); return t.length ? t : ["10:00", "20:00"]; }
const SITE_URL = "https://abergil023.github.io/People-manage-/";
function dayRanges() { const out = []; for (const k of reserveDays()) { const last = out[out.length - 1]; if (last && addDays(last.to, 1) === k) last.to = k; else out.push({ from: k, to: k }); } return out; }
function gcalLinks() {
  const title = `דיווח נוכחות – ${S.team.name}`;
  return dayRanges().flatMap(r => reportTimes().map(tm => {
    const n = Math.round((dOf(r.to) - dOf(r.from)) / 864e5) + 1;
    const st = r.from.replace(/-/g, "") + "T" + tm.replace(":", "") + "00";
    const enD = new Date(ms(`${r.from}T${tm}`) + 10 * 60000);
    const en = keyOf(enD).replace(/-/g, "") + "T" + pad(enD.getHours()) + pad(enD.getMinutes()) + "00";
    const url = "https://calendar.google.com/calendar/render?action=TEMPLATE&text=" + encodeURIComponent(title) + "&dates=" + st + "/" + en + "&ctz=Asia/Jerusalem&details=" + encodeURIComponent("לפתיחת הדיווח: " + SITE_URL + "#report") + "&recur=" + encodeURIComponent("RRULE:FREQ=DAILY;COUNT=" + n);
    return { label: `${r.from === r.to ? short(r.from) : span2(short(r.from), short(r.to))} · ${tm}`, url };
  }));
}
function icsFold(line) {
  const enc = new TextEncoder(); let out = "", cur = "", bytes = 0;
  for (const ch of line) { const b = enc.encode(ch).length; if (bytes + b > 73) { out += cur + "\r\n "; cur = ""; bytes = 1; } cur += ch; bytes += b; }
  return out + cur;
}
function icsText() {
  const esc2 = v => v.replace(/[\;,]/g, m => "\\" + m).replace(/\n/g, "\\n");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//matsevet//he", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VTIMEZONE", "TZID:Asia/Jerusalem",
    "BEGIN:DAYLIGHT", "TZOFFSETFROM:+0200", "TZOFFSETTO:+0300", "TZNAME:IDT", "DTSTART:19700327T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=23,24,25,26,27,28,29;BYDAY=FR", "END:DAYLIGHT",
    "BEGIN:STANDARD", "TZOFFSETFROM:+0300", "TZOFFSETTO:+0200", "TZNAME:IST", "DTSTART:19701025T020000", "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU", "END:STANDARD",
    "END:VTIMEZONE"];
  for (const k of reserveDays()) for (const tm of reportTimes()) {
    const d = k.replace(/-/g, ""), t = tm.replace(":", "");
    L.push("BEGIN:VEVENT", `UID:matsevet-${d}-${t}-${(S.user && S.user.uid || "x").slice(0, 8)}@abergil023.github.io`, `DTSTAMP:${stamp}`,
      `DTSTART;TZID=Asia/Jerusalem:${d}T${t}00`, "DURATION:PT10M",
      `SUMMARY:${esc2("דיווח נוכחות – " + S.team.name)}`, `DESCRIPTION:${esc2("לפתיחת הדיווח: " + SITE_URL + "#report")}`, `URL:${SITE_URL}#report`,
      "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc2("דיווח נוכחות")}`, "TRIGGER:PT0M", "END:VALARM", "END:VEVENT");
  }
  L.push("END:VCALENDAR");
  return L.map(icsFold).join("\r\n") + "\r\n";
}
/* ---------- render ---------- */
const app = document.getElementById("app");
function render() {
  document.body.classList.toggle("nowiz", !S.team);
  document.getElementById("teamName").textContent = S.team ? S.team.name : "ניהול כוח אדם · מילואים";
  document.title = S.team ? `מצבת הצוות · ${S.team.name}` : "מצבת הצוות";
  document.querySelectorAll(".tab").forEach(b => b.setAttribute("aria-current", b.dataset.tab === S.tab || (S.tab === "day" && b.dataset.tab === "cal") || (S.tab === "soldier" && b.dataset.tab === "soldiers") || (S.tab === "days" && b.dataset.tab === "settings") ? "page" : "false"));
  renderNow();
  const notice = S.notice ? `<div class="notice">${esc(S.notice)}</div>` : "";
  let body;
  if (S.auth !== "in") body = viewLogin();
  else if (!S.cloudReady) body = `<div class="empty">טוען את הנתונים מהענן…</div>`;
  else if (!S.team) body = viewWizard();
  else if (S.tab === "day") body = viewDay();
  else if (S.tab === "soldiers") body = viewSoldiers();
  else if (S.tab === "soldier") body = viewSoldier();
  else if (S.tab === "settings") body = viewSettings();
  else if (S.tab === "days") body = viewDaysEditor();
  else if (S.tab === "report") body = viewReport();
  else body = viewCal();
  app.innerHTML = notice + body;
}
function renderNow() {
  const el = document.getElementById("now");
  if (!S.team) { el.innerHTML = ""; return; }
  const p = presentNow();
  if (p) { el.innerHTML = `<b>${p.n}/${p.total}</b><span>נוכחים עכשיו</span>`; return; }
  const next = cache().days.find(k => k > todayKey());
  if (next) { const diff = Math.round((dOf(next) - dOf(todayKey())) / 864e5); el.innerHTML = `<b>${diff}</b><span>ימים ליום מילואים הבא (${short(next)})</span>`; }
  else el.innerHTML = `<span>סד״כ ${activeSoldiers().length}</span>`;
}

function viewCal() {
  const { days, info } = cache();
  if (!activeSoldiers().length && !days.length) return emptyState();
  const tk = todayKey();
  const done = days.filter(k => k < tk).length;
  const lows = days.filter(k => info.get(k).min < Number(settings().minStrength)).length;
  let out = `<div class="strip">
    <div class="stat"><b>${activeSoldiers().length}</b><span>סד״כ</span></div>
    <div class="stat"><b>${days.length}</b><span>ימי מילואים${done ? ` · עברו ${done}` : ""}</span></div>
    <div class="stat"><b style="color:var(${lows ? "--bad" : "--ok"})">${lows}</b><span>ימים מתחת ל־${esc(settings().minStrength)}</span></div>
  </div>`;
  if (!days.length) return out + `<div class="panel empty"><h2>עוד לא סומנו ימי מילואים</h2><p>מסמנים את הימים בלוח שנה, ואז רואים כאן את מצב הכוח בכל יום.</p><button class="btn primary" data-act="editdays">סימון ימי מילואים</button></div>`;
  const months = [...new Set(days.map(k => k.slice(0, 7)))];
  for (const m of months) {
    const [y, mo] = m.split("-").map(Number);
    const first = new Date(y, mo - 1, 1), count = new Date(y, mo, 0).getDate();
    let cells = DOW.map(d => `<div class="dow">${d}</div>`).join("");
    for (let i = 0; i < first.getDay(); i++) cells += `<div class="cell blank"></div>`;
    for (let d = 1; d <= count; d++) {
      const k = `${m}-${pad(d)}`, inf = info.get(k), today = k === tk ? " today" : "";
      if (inf) cells += `<button class="cell res${today}" data-day="${k}" aria-label="${longDate(k)}: ${inf.min} מתוך ${inf.total}">
          <span>${d}</span><span class="cnt ${statusCls(inf.min)}">${inf.min}<small>/${inf.total}</small></span>${inf.hasPartial ? `<span class="partial">שעות</span>` : ""}</button>`;
      else cells += `<div class="cell${today}">${d}</div>`;
    }
    out += `<section class="month"><h2>${MONTHS[mo - 1]} ${y}</h2><div class="grid">${cells}</div></section>`;
  }
  out += `<div class="legend"><span><i style="background:var(--ok-bg);border:1px solid var(--ok)"></i>מעל המינימום</span><span><i style="background:var(--warn-bg);border:1px solid var(--warn)"></i>בדיוק במינימום</span><span><i style="background:var(--bad-bg);border:1px solid var(--bad)"></i>מתחת למינימום</span><span>המספר הוא הנוכחות הנמוכה ביותר באותו יום · "שעות" = יש יציאה לפי שעות</span></div>`;
  return out;
}
function emptyState() {
  return `<div class="panel empty"><h2>עוד אין לוחמים במערכת</h2><p>מוסיפים לוחמים במסך ההגדרות, ואז הלוח מתמלא.</p><button class="btn primary" data-tab="settings">להגדרות</button></div>`;
}

function viewDay() {
  const { days, info } = cache();
  const inf = info.get(S.day);
  if (!inf) { S.tab = "cal"; return viewCal(); }
  const i = days.indexOf(S.day);
  const prev = days[i - 1], next = days[i + 1];
  const groups = { home: [], course: [], nir: [] };
  inf.per.forEach(p => { if (p.full) groups[p.full.type].push(p); });
  const partial = inf.per.filter(p => p.partial.length);
  const present = inf.per.filter(p => !p.full);
  const span = inf.s1 - inf.s0;
  const tl = inf.segs.map(s => `<div class="${statusCls(s.n)}" style="width:${((s.t1 - s.t0) / span * 100).toFixed(2)}%" title="${hm(s.t0)}–${s.t1 === inf.s1 ? "24:00" : hm(s.t1)}">${s.n}</div>`).join("");
  const segList = inf.segs.length > 1 ? `<div class="seglist">${inf.segs.map(s => `<div><span class="num">${span2(hm(s.t0), s.t1 === inf.s1 ? "24:00" : hm(s.t1))}</span><b class="num">${s.n}/${inf.total}</b></div>`).join("")}</div>` : "";
  const item = (p, a, extra = "") => `<li class="item"><div style="min-width:0"><div class="who">${esc(p.sol.name)} ${extra}</div><div class="meta">${esc(reasonText(a)) || "&nbsp;"} · ${esc(absRangeText(a))}</div></div><button class="btn small ghost" data-edit="${esc(a.id)}">עריכה</button></li>`;
  const sec = (t, arr) => arr.length ? `<div class="panel"><div class="row"><h2>${TYPES[t]}</h2><span class="chip ${TYPE_CLS[t]}">${arr.length}</span></div><ul class="list">${arr.map(p => item(p, p.full)).join("")}</ul></div>` : "";
  const clip = (a) => span2(hm(Math.max(inf.s0, ms(a.start))), Math.min(inf.s1, ms(a.end)) === inf.s1 ? "24:00" : hm(ms(a.end)));
  const partSec = partial.length ? `<div class="panel"><div class="row"><h2>יציאות לפי שעות</h2><span class="chip c-home">${partial.length}</span></div><ul class="list">${partial.flatMap(p => p.partial.map(a => item(p, a, `<span class="chip ${TYPE_CLS[a.type]}">${clip(a)}</span>`))).join("")}</ul></div>` : "";
  return `
  <div class="panel">
    <div class="dayhead">
      <button class="btn small" ${prev ? `data-day="${prev}"` : "disabled"} aria-label="יום קודם">→</button>
      <h2>${longDate(S.day)}</h2>
      <button class="btn small" ${next ? `data-day="${next}"` : "disabled"} aria-label="יום הבא">←</button>
    </div>
    <div class="row"><span class="eyebrow">יום מילואים ${i + 1} מתוך ${days.length}</span><button class="btn small ghost" data-tab="cal">חזרה ללוח</button></div>
    <div class="big"><b class="${statusCls(inf.min)}">${inf.min}/${inf.total}</b><span>${inf.hasPartial ? "הנוכחות הנמוכה ביותר במהלך היום" : "נוכחים כל היום"} · מינימום נדרש ${esc(settings().minStrength)}</span></div>
    <div><div class="timeline" aria-label="נוכחות לאורך היום">${tl}</div><div class="ticks"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div></div>
    ${segList}
    <div class="actions"><button class="btn primary" data-act="new" data-date="${S.day}">+ יציאה ביום הזה</button><button class="btn" data-act="copy">העתקת סיכום לוואטסאפ</button><button class="btn" data-tab="report">דיווח דוח 1</button></div>
    ${S.copyText != null ? `<div class="field"><label for="copybox">ההעתקה האוטומטית לא עבדה. סמנו את הטקסט והעתיקו ידנית:</label><textarea id="copybox" class="copybox" readonly>${esc(S.copyText)}</textarea></div>` : ""}
  </div>
  ${sec("home", groups.home)}${partSec}${sec("course", groups.course)}${sec("nir", groups.nir)}
  <div class="panel"><div class="row"><h2>נוכחים</h2><span class="chip c-present">${present.length}</span></div>
    <div class="names">${present.map(p => `<span>${esc(p.sol.name)}${p.partial.length ? " ⏱" : ""}</span>`).join("") || `<span class="muted">אין</span>`}</div></div>`;
}

function whatsappText(key) {
  const inf = cache().info.get(key);
  const d = dOf(key);
  const L = [`*מצב כוח אדם – יום ${DOW[d.getDay()]} ${short(key)}*`, `סד״כ: ${inf.min}/${inf.total}`];
  if (inf.segs.length > 1) L.push("לפי שעות: " + inf.segs.map(s => `${span2(hm(s.t0), s.t1 === inf.s1 ? "24:00" : hm(s.t1))}: ${s.n}`).join(" | "));
  for (const t of ["home", "course", "nir"]) {
    const arr = inf.per.filter(p => p.full && p.full.type === t);
    if (arr.length) { L.push("", `${TYPES[t]} (${arr.length}):`); arr.forEach(p => L.push(`• ${p.sol.name}${reasonText(p.full) ? " – " + reasonText(p.full) : ""}`)); }
  }
  const part = inf.per.filter(p => p.partial.length);
  if (part.length) {
    L.push("", `יציאות לפי שעות (${part.length}):`);
    part.forEach(p => p.partial.forEach(a => L.push(`• ${p.sol.name} ${span2(hm(Math.max(inf.s0, ms(a.start))), Math.min(inf.s1, ms(a.end)) === inf.s1 ? "24:00" : hm(ms(a.end)))}${reasonText(a) ? " – " + reasonText(a) : ""}`)));
  }
  const present = inf.per.filter(p => !p.full);
  L.push("", `נוכחים (${present.length}): ${present.map(p => p.sol.name).join(", ")}`);
  return L.join("\n");
}

function viewSoldiers() {
  const list = activeSoldiers().map(s => ({ s, st: soldierStats(s.id) }));
  if (!list.length) return emptyState();
  if (S.sort === "out") list.sort((a, b) => (b.st.home - a.st.home) || (b.st.partial - a.st.partial) || a.s.name.localeCompare(b.s.name, "he"));
  else list.sort((a, b) => (a.s.order ?? 0) - (b.s.order ?? 0));
  const days = cache().days.length || 1;
  const avg = list.reduce((n, x) => n + x.st.home, 0) / list.length;
  const rows = list.map(({ s, st }) => `<button class="srow" data-soldier="${esc(s.id)}">
      <span class="who" style="font-weight:700;overflow-wrap:anywhere">${esc(s.name)}</span>
      <span class="bar" aria-hidden="true"><i style="width:${st.home / days * 100}%;background:var(--home)"></i><i style="width:${st.course / days * 100}%;background:var(--course)"></i><i style="width:${st.nir / days * 100}%;background:var(--nir)"></i></span>
      <span class="n">${st.home} ימי בית${st.course ? ` · ${st.course} קורס` : ""}${st.partial ? ` · ${st.partial} בשעות` : ""}</span></button>`).join("");
  return `<div class="panel"><div class="row"><h2>יציאות לפי לוחם</h2>
      <div class="seg" role="group" aria-label="מיון"><button data-sort="out" aria-pressed="${S.sort === "out"}">הכי הרבה בבית</button><button data-sort="name" aria-pressed="${S.sort === "name"}">לפי הרשימה</button></div></div>
      <div class="muted" style="font-size:.88rem">ממוצע לצוות: <b class="num">${avg.toFixed(1)}</b> ימי בית ללוחם מתוך ${cache().days.length} ימי מילואים. נספרים רק ימי מילואים.</div>
      <div class="legend"><span><i style="background:var(--home)"></i>בבית</span><span><i style="background:var(--course)"></i>קורס</span><span><i style="background:var(--nir)"></i>לא במילואים</span></div>
    </div><div class="list">${rows}</div>`;
}

function viewSoldier() {
  const s = S.soldiers.find(x => x.id === S.soldier);
  if (!s) { S.tab = "soldiers"; return viewSoldiers(); }
  const st = soldierStats(s.id);
  const abs = S.absences.filter(a => a.soldierId === s.id).sort((a, b) => ms(a.start) - ms(b.start));
  const items = abs.map(a => `<li class="item"><div style="min-width:0"><div class="who"><span class="chip ${TYPE_CLS[a.type]}">${TYPES[a.type]}</span> ${esc(absRangeText(a))}</div>
      <div class="meta">${a.allDay ? `${absDays(a)} ימי מילואים` : "לפי שעות"}${reasonText(a) ? " · " + esc(reasonText(a)) : ""}</div></div><button class="btn small ghost" data-edit="${esc(a.id)}">עריכה</button></li>`).join("");
  return `<div class="panel">
    <div class="row"><h2 style="font-size:1.3rem">${esc(s.name)}</h2><button class="btn small ghost" data-tab="soldiers">חזרה לרשימה</button></div>
    <div class="tiles">
      <div class="stat"><b>${st.present}</b><span>ימים נוכח</span></div>
      <div class="stat"><b style="color:var(--home)">${st.home}</b><span>ימים בבית</span></div>
      <div class="stat"><b style="color:var(--course)">${st.course}</b><span>ימי קורס</span></div>
      <div class="stat"><b>${st.partial}</b><span>ימים עם יציאה בשעות</span></div>
    </div>
    ${st.nir ? `<div class="muted">לא במילואים: ${st.nir} ימים</div>` : ""}
    <button class="btn primary" data-act="new" data-soldier-id="${esc(s.id)}">+ יציאה ל${esc(s.name)}</button>
  </div>
  <div class="panel"><h2>כל היציאות וההיעדרויות</h2>${items ? `<ul class="list">${items}</ul>` : `<div class="empty">עוד אין יציאות רשומות ל${esc(s.name)}.</div>`}</div>`;
}

function viewSettings() {
  const st = settings();
  const sol = [...S.soldiers].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const act = sol.filter(s => s.active !== false), inact = sol.filter(s => s.active === false);
  const r = S.restore;
  return `<div class="panel"><h2>הצוות</h2>
      <div class="field"><label for="teamNameInp">שם הצוות</label><input class="inp" id="teamNameInp" value="${esc(S.team.name)}"></div>
      <div class="field"><label for="minStrength">מינימום נוכחים</label><div class="setrow"><input class="inp num" type="number" min="0" id="minStrength" value="${esc(st.minStrength)}"><span class="muted">מתחת למספר הזה היום נצבע באדום</span></div></div></div>
    <div class="panel"><div class="row"><h2>ימי מילואים</h2><span class="chip c-present">${reserveDays().length} ימים</span></div>
      <div class="muted">${reserveRangesText() || "עוד לא סומנו ימים."}</div>
      <button class="btn" data-act="editdays">עריכת ימי מילואים בלוח</button></div>
    <div class="panel"><div class="row"><h2>לוחמים</h2><span class="chip c-present">סד״כ ${act.length}</span></div>
      <ul class="list">${act.map(s => `<li class="setrow"><input class="inp" id="sn-${esc(s.id)}" value="${esc(s.name)}" data-rename="${esc(s.id)}" aria-label="שם הלוחם"><button class="btn small danger" data-deact="${esc(s.id)}">הסרה</button></li>`).join("")}</ul>
      <form class="setrow" id="addSoldier"><input class="inp" id="newSoldier" placeholder="שם לוחם חדש" aria-label="שם לוחם חדש"><button class="btn primary small">הוספה</button></form>
      ${inact.length ? `<div class="lbl">הוסרו (ההיסטוריה שלהם נשמרת)</div><ul class="list">${inact.map(s => `<li class="item"><span>${esc(s.name)}</span><button class="btn small" data-react="${esc(s.id)}">החזרה</button></li>`).join("")}</ul>` : ""}
    </div>
    <div class="panel" id="reminders"><div class="row"><h2>תזכורות לדיווח</h2><span class="chip c-nir">לא חובה</span></div>
      <div class="muted" style="font-size:.9rem">אם רוצים, אפשר להוסיף ליומן בטלפון תזכורת בכל יום מילואים. לוחצים על התזכורת, נפתח דוח 1, ושולחים אותו בוואטסאפ. בלי תזכורות, הדוח זמין תמיד בלשונית "דוח 1".</div>
      <div class="two">${reportTimes().map((t, i) => `<div class="field"><label for="rtime${i}">שעת דיווח ${i + 1}</label><input type="time" class="inp" id="rtime${i}" data-rtime="${i}" value="${t}"></div>`).join("")}</div>
      ${reserveDays().length ? `<div class="actions"><button class="btn primary" data-act="ics">הוספה ליומן הטלפון</button><span class="muted" style="font-size:.85rem">אייפון, סמסונג ו־Outlook</span></div>
      <div class="lbl">ביומן Google, לוחצים על כל קישור ושומרים:</div>
      <div class="gcal">${gcalLinks().map(g => `<a class="btn small" href="${g.url}" target="_blank" rel="noopener">${g.label}</a>`).join("")}</div>
      <div class="muted" style="font-size:.85rem">ביומן Google ההתראה מגיעה לפי הגדרות ברירת המחדל של היומן. אם משנים ימי מילואים או שעות, מוסיפים שוב. כדי לבטל, מוחקים את האירועים מהיומן.</div>` : `<div class="muted">קודם מסמנים ימי מילואים.</div>`}
    </div>
    <div class="panel"><h2>חשבון</h2>
      <div class="muted" style="font-size:.9rem">מחובר כ־<b dir="ltr">${esc(S.user?.email || "")}</b>. הנתונים נשמרים בענן בחשבון הזה ופרטיים רק לך. כדי לראות אותם במכשיר אחר, מתחברים שם עם אותו חשבון Google.</div>
      <div class="actions"><button class="btn" data-act="logout">התנתקות</button></div></div>
    <div class="panel" id="backup"><h2>עותק גיבוי (לא חובה)</h2>
      <div class="muted" style="font-size:.9rem">הנתונים כבר שמורים בענן. אם רוצים, אפשר לשמור גם עותק בקובץ או בקוד.</div>
      <div class="actions"><button class="btn primary" data-act="download">הורדת קובץ גיבוי</button><button class="btn" data-act="copycode">העתקת קוד גיבוי</button></div>
      ${S.backupCode != null ? `<div class="field"><label for="codebox">ההעתקה האוטומטית לא עבדה. סמנו את הקוד והעתיקו ידנית:</label><textarea id="codebox" class="copybox" readonly>${esc(S.backupCode)}</textarea></div>` : ""}
      <div class="lbl">שחזור</div>
      <div class="actions"><label class="btn" for="restoreFile" style="display:inline-block">שחזור מקובץ</label><input type="file" id="restoreFile" accept=".json,application/json,text/plain" hidden></div>
      <div class="field"><label for="restoreCode">או הדבקת קוד גיבוי</label><textarea id="restoreCode" class="inp" rows="3" placeholder="מדביקים כאן את הקוד ששמרתם"></textarea></div>
      <div class="actions"><button class="btn" data-act="restorecode">שחזור מהקוד</button></div>
      ${S.restoreErr ? `<div class="err" role="alert">${esc(S.restoreErr)}</div>` : ""}
      ${r ? `<div class="confirm" role="alert"><b>לשחזר את הגיבוי?</b><span>צוות "${esc(r.team.name)}" · ${r.soldiers.length} לוחמים · ${r.absences.length} יציאות · ${r.settings.reserveDays.length} ימי מילואים.<br>כל הנתונים הנוכחיים בטלפון יוחלפו.</span>
        <div class="actions"><button class="btn danger" data-act="restoreok">כן, לשחזר</button><button class="btn" data-act="restorecancel">ביטול</button></div></div>` : ""}
    </div>
    <div class="panel"><h2>איפוס</h2><div class="muted" style="font-size:.9rem">מוחק את כל נתוני הצוות מהענן ומתחיל מחדש. אי אפשר לבטל את זה.</div>
      <div class="actions"><button class="btn danger" data-act="reset">${["מחיקת כל הנתונים", "בטוח? זה ימחק הכול", "לחיצה אחרונה: למחוק"][S.resetStep]}</button>${S.resetStep ? `<button class="btn" data-act="resetcancel">ביטול</button>` : ""}</div></div>`;
}

function reserveRangesText() {
  const days = reserveDays(); const out = []; let a = null, b = null;
  for (const k of days) { if (b && addDays(b, 1) === k) b = k; else { if (a) out.push(a === b ? short(a) : span2(short(a), short(b))); a = b = k; } }
  if (a) out.push(a === b ? short(a) : span2(short(a), short(b)));
  return out.join(" · ");
}

function backupBanner() {
  if (!S.soldiers.length) return "";
  const since = S.lastBackup || S.team.createdAt || Date.now();
  if (Date.now() - since < 7 * 864e5) return "";
  return `<div class="banner"><span>${S.lastBackup ? "עבר יותר משבוע מהגיבוי האחרון." : "עוד לא גיביתם את הנתונים."} הנתונים שמורים רק בטלפון הזה.</span><button class="btn small primary" data-act="gobackup">לגיבוי</button></div>`;
}

/* ---------- day picker (wizard step 3 + settings) ---------- */
function startPick() {
  const days = reserveDays();
  const first = days.find(k => k >= todayKey()) || days[0] || todayKey();
  S.pick = { month: first.slice(0, 7), days: new Set(days) };
}
function pickerHtml() {
  const P = S.pick; const [y, mo] = P.month.split("-").map(Number);
  const first = new Date(y, mo - 1, 1), count = new Date(y, mo, 0).getDate(), tk = todayKey();
  let cells = DOW.map(d => `<div class="dow">${d}</div>`).join("");
  for (let i = 0; i < first.getDay(); i++) cells += `<div></div>`;
  for (let d = 1; d <= count; d++) {
    const k = `${P.month}-${pad(d)}`;
    cells += `<button type="button" class="pcell${k === tk ? " today" : ""}${k < tk ? " past" : ""}" data-pick="${k}" aria-pressed="${P.days.has(k)}">${d}</button>`;
  }
  const inMonth = [...P.days].filter(k => k.startsWith(P.month)).length;
  return `<div class="panel">
    <div class="pickhead"><button type="button" class="btn small" data-pmonth="-1" aria-label="חודש קודם">→</button><h2>${MONTHS[mo - 1]} ${y}</h2><button type="button" class="btn small" data-pmonth="1" aria-label="חודש הבא">←</button></div>
    <div class="grid">${cells}</div>
    <div class="row"><span class="muted" style="font-size:.88rem">${inMonth} ימים מסומנים בחודש הזה</span>${inMonth ? `<button type="button" class="btn small ghost" data-act="pclearmonth">ניקוי החודש</button>` : ""}</div>
  </div>`;
}
function viewDaysEditor() {
  return `<div class="panel"><h2>ימי מילואים</h2><div class="muted">לוחצים על כל יום שבו הצוות במילואים. לחיצה נוספת מבטלת. אפשר לעבור בין חודשים בחצים.</div></div>
    ${pickerHtml()}
    <div class="sticky-actions"><b class="num">נבחרו ${S.pick.days.size} ימים</b><div class="actions"><button class="btn primary" data-act="savedays">שמירה</button><button class="btn" data-act="canceldays">ביטול</button></div></div>`;
}

/* ---------- login ---------- */
function viewLogin() {
  if (S.auth === "loading") return `<div class="empty">טוען…</div>`;
  if (S.auth === "noconfig") return `<div class="panel wiz"><h1>המערכת עוד לא חוברה לענן</h1><p>מנהל המערכת צריך להשלים את חיבור הפרויקט ל־Firebase. נסו שוב מאוחר יותר.</p></div>`;
  if (S.auth === "nosdk") return `<div class="panel wiz"><h1>אין חיבור</h1><p>לא הצלחתי לטעון את רכיב ההתחברות. בדקו שיש אינטרנט ורעננו את הדף.</p></div>`;
  const inApp = /FBAN|FBAV|Instagram|Line\/|; wv\)/.test(navigator.userAgent);
  return `<div class="panel wiz">
    <span class="eyebrow">ניהול כוח אדם · מילואים</span>
    <h1>מצבת הצוות</h1>
    <p>כמה לוחמים יש בכל יום, מי בבית ולמה, מי יצא כמה, וסיכום מוכן לוואטסאפ. מתחברים עם חשבון Google, והנתונים של הצוות שלך נשמרים בענן ופרטיים רק לך. אפשר להיכנס מכל טלפון או מחשב.</p>
    <div class="actions"><button class="btn primary" data-act="login">התחברות עם Google</button></div>
    ${inApp ? `<div class="notice">נראה שהקישור נפתח בתוך אפליקציה. אם ההתחברות לא עובדת, פתחו אותו בדפדפן (Chrome או Safari) דרך התפריט ⋮.</div>` : ""}
    ${S.loginErr ? `<div class="err" role="alert">${esc(S.loginErr)}</div>` : ""}
  </div>`;
}

/* ---------- first-run wizard ---------- */
function viewWizard() {
  const W = S.wiz || (S.wiz = { step: 1, name: "", names: [] });
  const steps = `<div class="steps" aria-hidden="true">${[1, 2, 3].map(i => `<i class="${i <= W.step ? "on" : ""}"></i>`).join("")}</div>`;
  const L = S.localFound;
  const migrate = L && W.step === 1 ? `<div class="panel wiz"><h2>נמצאו נתונים בטלפון הזה</h2><p>צוות "${esc(L.team.name)}" · ${L.soldiers.length} לוחמים · ${L.absences.length} יציאות · ${L.settings.reserveDays.length} ימי מילואים. הנתונים נשמרו בגרסה הקודמת של המערכת, שעבדה בלי ענן.</p>
      <div class="actions"><button class="btn primary" data-act="migrate">העברה לענן</button><button class="btn" data-act="skipmigrate">התחלה מחדש</button></div></div>` : "";
  if (W.step === 1) return migrate + `<form class="panel wiz" id="wiz1">${steps}<span class="eyebrow">שלב 1 מתוך 3</span>
      <h1>ברוך הבא למצבת הצוות</h1><p>כאן מרכזים את כוח האדם של הצוות במילואים: כמה לוחמים יש בכל יום, מי בבית ולמה, ומי יצא כמה. הנתונים נשמרים בענן בחשבון Google שלך, ורק אתה רואה אותם.</p>
      <div class="field"><label for="wName">שם הצוות</label><input class="inp" id="wName" value="${esc(W.name)}" placeholder="לדוגמה: צוות 2, פלוגה ב׳" required></div>
      <div class="actions"><button class="btn primary">המשך</button></div>
      <div class="muted" style="font-size:.85rem">יש לך קובץ או קוד גיבוי? <button type="button" class="btn small ghost" data-act="wizrestore">שחזור מגיבוי</button></div>
      ${W.restore ? `<div class="field"><label for="restoreCode">הדבקת קוד גיבוי</label><textarea id="restoreCode" class="inp" rows="3"></textarea></div>
        <div class="actions"><button type="button" class="btn" data-act="restorecode">שחזור מהקוד</button><label class="btn" for="restoreFile">שחזור מקובץ</label><input type="file" id="restoreFile" accept=".json,application/json,text/plain" hidden></div>
        ${S.restoreErr ? `<div class="err" role="alert">${esc(S.restoreErr)}</div>` : ""}
        ${S.restore ? `<div class="confirm"><b>לשחזר את צוות "${esc(S.restore.team.name)}"?</b><span>${S.restore.soldiers.length} לוחמים · ${S.restore.absences.length} יציאות</span><div class="actions"><button type="button" class="btn danger" data-act="restoreok">כן, לשחזר</button><button type="button" class="btn" data-act="restorecancel">ביטול</button></div></div>` : ""}` : ""}
    </form>`;
  if (W.step === 2) return `<div class="panel wiz">${steps}<span class="eyebrow">שלב 2 מתוך 3</span>
      <h1>מי בצוות?</h1><p>מוסיפים את שמות הלוחמים אחד אחד. אחרי כל שם לוחצים Enter או "הוספה". אפשר להוסיף ולשנות גם אחר כך.</p>
      <form class="setrow" id="wiz2add"><input class="inp" id="wSoldier" placeholder="שם הלוחם" aria-label="שם הלוחם" autocomplete="off"><button class="btn primary small">הוספה</button></form>
      ${W.names.length ? `<div class="row"><span class="lbl">בצוות</span><span class="chip c-present">סד״כ ${W.names.length}</span></div>
        <ul class="list">${W.names.map((n, i) => `<li class="item"><span class="who">${esc(n)}</span><button type="button" class="btn small ghost" data-wdel="${i}" aria-label="הסרת ${esc(n)}">הסרה</button></li>`).join("")}</ul>` : `<div class="empty">עוד לא נוספו לוחמים.</div>`}
      ${W.err ? `<div class="err" role="alert">${esc(W.err)}</div>` : ""}
      <div class="actions"><button type="button" class="btn primary" data-act="wiznext">המשך</button><button type="button" class="btn" data-act="wizback">חזרה</button></div></div>`;
  return `<div class="panel wiz">${steps}<span class="eyebrow">שלב 3 מתוך 3</span>
      <h1>מתי אתם במילואים?</h1><p>לוחצים על כל יום שבו הצוות במילואים. אפשר לעבור בין חודשים בחצים, ולשנות בכל זמן מההגדרות.</p></div>
    ${pickerHtml()}
    <div class="sticky-actions"><b class="num">נבחרו ${S.pick.days.size} ימים</b><div class="actions"><button class="btn primary" data-act="wizdone">סיום וכניסה ללוח</button><button class="btn" data-act="wizback">חזרה</button></div></div>`;
}
/* ---------- absence form ---------- */
const modal = document.getElementById("modal");
let form = null;
function openForm(opts) {
  const a = opts.id ? S.absences.find(x => x.id === opts.id) : null;
  const date = opts.date || (cache().days.find(k => k >= todayKey()) || todayKey());
  form = a ? {
    id: a.id, soldierId: a.soldierId, type: a.type, reason: a.reason || "יציאה", note: a.note || "", allDay: !!a.allDay,
    fromDate: a.start.slice(0, 10), toDate: a.allDay ? addDays(a.end.slice(0, 10), -1) : a.end.slice(0, 10),
    fromTime: a.allDay ? "14:00" : a.start.slice(11), toTime: a.allDay ? "22:00" : a.end.slice(11), confirmDel: false, err: ""
  } : { id: null, soldierId: opts.soldierId || "", type: "home", reason: "יציאה", note: "", allDay: true, fromDate: date, toDate: date, fromTime: "14:00", toTime: "22:00", confirmDel: false, err: "" };
  drawForm();
}
function drawForm() {
  if (!form) { modal.innerHTML = ""; return; }
  const f = form;
  const opts = activeSoldiers().map(s => `<option value="${esc(s.id)}" ${s.id === f.soldierId ? "selected" : ""}>${esc(s.name)}</option>`).join("");
  modal.innerHTML = `<div class="overlay" data-act="close"><form class="sheet" id="absForm" role="dialog" aria-modal="true" aria-labelledby="ftitle">
    <div class="row"><h2 id="ftitle">${f.id ? "עריכת" : "הוספת"} יציאה / היעדרות</h2><button type="button" class="btn small ghost" data-act="close">סגירה</button></div>
    <div class="field"><label for="fSoldier">לוחם</label><select id="fSoldier" required><option value="">בחירת לוחם…</option>${opts}</select></div>
    <div class="field"><span class="lbl">סטטוס</span><div class="seg" role="group">${Object.entries(TYPES).map(([k, v]) => `<button type="button" data-ftype="${k}" aria-pressed="${f.type === k}">${v}</button>`).join("")}</div></div>
    ${f.type === "home" ? `<div class="field"><span class="lbl">סיבה</span><div class="seg" role="group" style="flex-wrap:wrap">${REASONS.map(r => `<button type="button" data-freason="${r}" aria-pressed="${f.reason === r}">${r}</button>`).join("")}</div></div>` : ""}
    <div class="field"><span class="lbl">משך</span><div class="seg" role="group"><button type="button" data-fall="1" aria-pressed="${f.allDay}">ימים שלמים</button><button type="button" data-fall="0" aria-pressed="${!f.allDay}">לפי שעות</button></div></div>
    <div class="two">
      <div class="field"><label for="fFrom">${f.allDay ? "מתאריך" : "יציאה בתאריך"}</label><input type="date" id="fFrom" value="${f.fromDate}" required></div>
      <div class="field"><label for="fTo">${f.allDay ? "עד תאריך (כולל)" : "חזרה בתאריך"}</label><input type="date" id="fTo" value="${f.toDate}" required></div>
      ${f.allDay ? "" : `<div class="field"><label for="fFromT">שעת יציאה</label><input type="time" id="fFromT" value="${f.fromTime}" required></div>
      <div class="field"><label for="fToT">שעת חזרה</label><input type="time" id="fToT" value="${f.toTime}" required></div>`}
    </div>
    <div class="field"><label for="fNote">הערה</label><input id="fNote" value="${esc(f.note)}" placeholder="לא חובה"></div>
    ${f.err ? `<div class="err" role="alert">${esc(f.err)}</div>` : ""}
    <div class="actions"><button class="btn primary" type="submit">שמירה</button>
      ${f.id ? `<button type="button" class="btn danger" data-act="del">${f.confirmDel ? "בטוח? למחוק" : "מחיקה"}</button>` : ""}</div>
  </form></div>`;
}
function readForm() {
  if (!form) return;
  const g = id => document.getElementById(id);
  form.soldierId = g("fSoldier").value; form.fromDate = g("fFrom").value; form.toDate = g("fTo").value; form.note = g("fNote").value.trim();
  if (g("fFromT")) { form.fromTime = g("fFromT").value; form.toTime = g("fToT").value; }
}
async function saveForm() {
  readForm();
  const f = form;
  if (!f.soldierId) { f.err = "צריך לבחור לוחם."; return drawForm(); }
  if (!f.fromDate || !f.toDate) { f.err = "צריך למלא תאריכים."; return drawForm(); }
  const start = f.allDay ? `${f.fromDate}T00:00` : `${f.fromDate}T${f.fromTime}`;
  const end = f.allDay ? `${addDays(f.toDate, 1)}T00:00` : `${f.toDate}T${f.toTime}`;
  if (ms(end) <= ms(start)) { f.err = "מועד החזרה צריך להיות אחרי מועד היציאה."; return drawForm(); }
  const doc = { soldierId: f.soldierId, type: f.type, reason: f.type === "home" ? f.reason : "", note: f.note, allDay: f.allDay, start, end, updatedAt: new Date().toISOString() };
  const id = f.id || uid("a");
  try { await write(db.collection("absences").doc(id), "set", doc); form = null; drawForm(); toast("נשמר"); }
  catch (e) { f.err = writeError(e); drawForm(); }
}

/* ---------- local storage (private to this browser) ---------- */
const KEY = "matsevet-team-v1";
function snapshot() { return { app: "matsevet", version: 1, team: S.team, soldiers: S.soldiers, absences: S.absences, settings: S.settings, lastBackup: S.lastBackup }; }
/* cloud: one private Firestore document per Google account: teams/{uid} */
let fb = null, docRef = null, unsub = null, saveTimer = null;
function persist() {
  if (!docRef || !S.team || S.blocked) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const data = JSON.parse(JSON.stringify(snapshot()));
    data.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
    docRef.set(data).then(() => { if (S.notice === SAVE_ERR) { S.notice = ""; render(); } })
      .catch(err => { console.error(err); S.notice = SAVE_ERR; render(); });
  }, 400);
}
const SAVE_ERR = "השמירה בענן נכשלה. השינויים נשמרו בטלפון וישלחו כשהחיבור יחזור. אם זה ממשיך, נסו להתנתק ולהתחבר שוב.";
function readLocalOld() { try { const raw = localStorage.getItem(KEY); return raw ? validData(JSON.parse(raw), true) : null; } catch { return null; } }
function clearState() { S.team = null; S.soldiers = []; S.absences = []; S.settings = { reserveDays: [], minStrength: 15 }; S.lastBackup = null; S.cache = null; S.wiz = null; S.pick = null; S.tab = location.hash === "#report" ? "report" : "cal"; S.resetStep = 0; S.restore = null; }
function attachUser(user) {
  if (unsub) { unsub(); unsub = null; }
  clearState(); S.user = user; S.cloudReady = false;
  if (!user) { docRef = null; S.auth = "out"; render(); return; }
  S.auth = "in"; render();
  docRef = fb.firestore().collection("teams").doc(user.uid);
  unsub = docRef.onSnapshot(snap => {
    if (saveTimer || snap.metadata.hasPendingWrites) return; // our own write echoing back
    const d = snap.exists ? validData(snap.data(), false) : null;
    if (snap.exists && !d) { S.blocked = true; S.notice = "לא הצלחתי לקרוא את הנתונים השמורים בענן. כדי לא לפגוע בהם, השמירה הושבתה. פנו למנהל המערכת."; S.cloudReady = true; render(); return; }
    S.blocked = false;
    if (d) applyData(d); else { const keepWiz = S.wiz, keepPick = S.pick; clearState(); S.wiz = keepWiz; S.pick = keepPick; S.localFound = readLocalOld(); }
    S.cache = null; S.cloudReady = true; render();
  }, err => { console.error(err); S.notice = "אין גישה לנתונים בענן. בדקו את החיבור ורעננו את הדף."; S.cloudReady = true; render(); });
}
async function secureSignOut() {
  clearTimeout(saveTimer); saveTimer = null;
  if (unsub) { unsub(); unsub = null; }
  try { await fb.auth().signOut(); } catch (e) { console.error(e); }
  try { await fb.firestore().terminate(); await fb.firestore().clearPersistence(); } catch (e) { console.error(e); }
  try { localStorage.removeItem(KEY); sessionStorage.clear(); } catch {}
  location.reload();
}
async function signIn() {
  S.loginErr = ""; const prov = new firebase.auth.GoogleAuthProvider(); prov.setCustomParameters({ prompt: "select_account" });
  try { await fb.auth().signInWithPopup(prov); }
  catch (e) {
    if (["auth/popup-blocked", "auth/operation-not-supported-in-this-environment", "auth/web-storage-unsupported"].includes(e.code)) { try { await fb.auth().signInWithRedirect(prov); return; } catch (e2) { e = e2; } }
    if (e.code === "auth/popup-closed-by-user" || e.code === "auth/cancelled-popup-request") return;
    S.loginErr = e.code === "auth/unauthorized-domain" ? "הכתובת הזו עוד לא אושרה בפרויקט Firebase (Authorized domains)." : e.code === "auth/network-request-failed" ? "אין חיבור לאינטרנט. נסו שוב." : "ההתחברות נכשלה. נסו שוב, או פתחו את הקישור ב־Chrome או Safari.";
    render();
  }
}
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const LIMITS = { soldiers: 300, absences: 5000, reserveDays: 400 };
function cleanStr(v, max) { return String(v ?? "").replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, "").trim().slice(0, max); }
/* Validates and normalizes a team document (from the cloud or a backup).
   strict=true (backups): reject anything over the limits. strict=false (cloud): drop invalid items, keep the rest. */
function validData(o, strict) {
  if (!o || typeof o !== "object" || !o.team || typeof o.team !== "object" || typeof o.team.name !== "string" || !Array.isArray(o.soldiers) || !Array.isArray(o.absences) || !o.settings || !Array.isArray(o.settings.reserveDays)) return null;
  if (strict && (o.soldiers.length > LIMITS.soldiers || o.absences.length > LIMITS.absences || o.settings.reserveDays.length > LIMITS.reserveDays)) return null;
  const okKey = k => typeof k === "string" && /^\d{4}-\d{2}-\d{2}$/.test(k);
  const okT = t => typeof t === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(t);
  const name = cleanStr(o.team.name, 80);
  if (!name) return null;
  const soldiers = o.soldiers.filter(x => x && typeof x === "object" && typeof x.id === "string" && ID_RE.test(x.id) && cleanStr(x.name, 60))
    .slice(0, LIMITS.soldiers).map(x => ({ id: x.id, name: cleanStr(x.name, 60), active: x.active !== false, order: Number.isFinite(Number(x.order)) ? Number(x.order) : 0 }));
  const absences = o.absences.filter(a => a && typeof a === "object" && typeof a.id === "string" && ID_RE.test(a.id) && typeof a.soldierId === "string" && ID_RE.test(a.soldierId)
      && Object.prototype.hasOwnProperty.call(TYPES, a.type) && okT(a.start) && okT(a.end) && a.end > a.start)
    .slice(0, LIMITS.absences)
    .map(a => ({ id: a.id, soldierId: a.soldierId, type: a.type, reason: a.type === "home" && REASONS.includes(a.reason) ? a.reason : "", note: cleanStr(a.note, 300), allDay: a.allDay === true, start: a.start, end: a.end, updatedAt: typeof a.updatedAt === "string" ? a.updatedAt.slice(0, 40) : "" }));
  const reportTimes = Array.isArray(o.settings.reportTimes) ? o.settings.reportTimes.filter(x => typeof x === "string" && /^\d{2}:\d{2}$/.test(x)).slice(0, 4) : [];
  return {
    team: { name, createdAt: Number.isFinite(Number(o.team.createdAt)) && Number(o.team.createdAt) > 0 ? Number(o.team.createdAt) : Date.now() },
    soldiers, absences,
    settings: { reserveDays: [...new Set(o.settings.reserveDays.filter(okKey))].sort().slice(0, LIMITS.reserveDays), minStrength: Math.min(1000, Math.max(0, parseInt(o.settings.minStrength, 10) || 0)), reportTimes: reportTimes.length ? reportTimes : ["10:00", "20:00"] },
    lastBackup: Number.isFinite(Number(o.lastBackup)) && Number(o.lastBackup) > 0 ? Number(o.lastBackup) : null
  };
}
function applyData(d) { S.team = d.team; S.soldiers = d.soldiers.sort((a, b) => a.order - b.order); S.absences = d.absences; S.settings = d.settings; S.lastBackup = d.lastBackup; S.cache = null; }
const COLL = { soldiers: () => S.soldiers, absences: () => S.absences };
function ref(c, id) {
  return {
    async set(data) {
      if (c === "settings") S.settings = { ...data };
      else { const arr = COLL[c](); const i = arr.findIndex(x => x.id === id); const doc = { id, ...data }; if (i >= 0) arr[i] = doc; else arr.push(doc); }
      onData();
    },
    async update(data) { const arr = COLL[c](); const x = arr.find(y => y.id === id); if (!x) throw { code: "invalid_argument" }; Object.assign(x, data); onData(); },
    async delete() { const arr = COLL[c](); const i = arr.findIndex(x => x.id === id); if (i >= 0) arr.splice(i, 1); onData(); }
  };
}
const db = { collection: c => ({ doc: id => ref(c, id) }), doc: p => { const [c, id] = p.split("/"); return ref(c, id); } };
async function write(r, op, data) { return r[op](data); }
function writeError() { return "השמירה נכשלה. נסו שוב."; }
async function saveSettings(patch) { S.settings = { ...settings(), ...patch }; onData(); toast("נשמר"); }

/* ---------- backup ---------- */
function toB64(str) { const bytes = new TextEncoder().encode(str); let bin = ""; bytes.forEach(b => bin += String.fromCharCode(b)); return btoa(bin); }
function fromB64(b64) { const bin = atob(b64); return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))); }
function backupCode() { return "MATSEVET1:" + toB64(JSON.stringify(snapshot())); }
function parseBackup(text) {
  text = String(text || "").trim();
  try {
    let json = text;
    const i = text.indexOf("MATSEVET1:");
    if (i >= 0) json = fromB64(text.slice(i + 10).replace(/\s+/g, ""));
    return validData(JSON.parse(json), true);
  } catch { return null; }
}
function markBackedUp() { S.lastBackup = Date.now(); persist(); }
function offerRestore(text) {
  const d = parseBackup(text);
  if (!d) { S.restore = null; S.restoreErr = "זה לא נראה כמו גיבוי תקין של מצבת הצוות. בדקו שהעתקתם את כל הקוד."; }
  else { S.restore = d; S.restoreErr = ""; }
  render();
}

let toastT;
function toast(msg) { const t = document.getElementById("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2200); }

/* ---------- events ---------- */
document.addEventListener("click", async e => {
  const el = e.target.closest("button, [data-act='close']");
  if (!el) return;
  const d = el.dataset;
  if (d.act === "close" && e.target !== el && el.classList.contains("overlay")) return; // click inside sheet
  if (d.tab) { if (location.hash === "#report" && d.tab !== "report") location.hash = ""; S.tab = d.tab; S.copyText = null; S.backupCode = null; S.restore = null; S.restoreErr = ""; S.resetStep = 0; render(); window.scrollTo(0, 0); return; }
  if (d.day) { S.day = d.day; S.tab = "day"; S.copyText = null; render(); window.scrollTo(0, 0); return; }
  if (d.soldier) { S.soldier = d.soldier; S.tab = "soldier"; render(); window.scrollTo(0, 0); return; }
  if (d.sort) { S.sort = d.sort; render(); return; }
  if (d.edit) { openForm({ id: d.edit }); return; }
  if (d.act === "new") { openForm({ date: d.date || (S.tab === "day" ? S.day : null), soldierId: d.soldierId || (S.tab === "soldier" ? S.soldier : "") }); return; }
  if (d.act === "close") { form = null; drawForm(); return; }
  if (d.ftype) { readForm(); form.type = d.ftype; drawForm(); return; }
  if (d.freason) { readForm(); form.reason = d.freason; drawForm(); return; }
  if (d.fall) { readForm(); form.allDay = d.fall === "1"; drawForm(); return; }
  if (d.act === "del") {
    if (!form.confirmDel) { readForm(); form.confirmDel = true; drawForm(); return; }
    try { await write(db.collection("absences").doc(form.id), "delete"); form = null; drawForm(); toast("נמחק"); } catch (err) { form.err = writeError(err); drawForm(); }
    return;
  }
  if (d.act === "copy") {
    const text = whatsappText(S.day);
    try { await navigator.clipboard.writeText(text); S.copyText = null; toast("הסיכום הועתק"); }
    catch { S.copyText = text; render(); const b = document.getElementById("copybox"); if (b) { b.focus(); b.select(); } }
    return;
  }
  if (d.deact) { try { await write(db.collection("soldiers").doc(d.deact), "update", { active: false }); toast("הלוחם הוסר מהסד״כ"); } catch (err) { toast(writeError(err)); } return; }
  if (d.react) { try { await write(db.collection("soldiers").doc(d.react), "update", { active: true }); toast("הלוחם הוחזר"); } catch (err) { toast(writeError(err)); } return; }
});
document.addEventListener("submit", async e => {
  e.preventDefault();
  if (e.target.id === "absForm") return saveForm();
  if (e.target.id === "addSoldier") {
    const inp = document.getElementById("newSoldier"); const name = inp.value.trim(); if (!name) return;
    const order = Math.max(0, ...S.soldiers.map(s => s.order ?? 0)) + 1;
    try { await write(db.collection("soldiers").doc(uid("s")), "set", { name, active: true, order }); toast("נוסף"); } catch (err) { toast(writeError(err)); }
  }
});
document.addEventListener("change", async e => {
  const t = e.target;
  if (t.id === "minStrength") { const v = Math.max(0, parseInt(t.value, 10) || 0); saveSettings({ minStrength: v }); return; }
  if (t.dataset.rtime != null) { const arr = [...reportTimes()]; if (/^\d{2}:\d{2}$/.test(t.value)) { arr[Number(t.dataset.rtime)] = t.value; saveSettings({ reportTimes: arr }); } return; }
  if (t.id === "teamNameInp") { const name = t.value.trim(); if (!name) return; S.team = { ...S.team, name }; onData(); toast("נשמר"); return; }
  if (t.id === "restoreFile" && t.files && t.files[0]) {
    const f = t.files[0]; if (f.size > 5e6) { S.restoreErr = "הקובץ גדול מדי לגיבוי."; render(); return; }
    const rd = new FileReader(); rd.onload = () => { if (S.wiz) S.wiz.restore = true; offerRestore(rd.result); }; rd.onerror = () => { S.restoreErr = "לא הצלחתי לקרוא את הקובץ."; render(); }; rd.readAsText(f); return;
  }
  if (t.dataset.rename) { const name = t.value.trim(); if (!name) return; try { await write(db.collection("soldiers").doc(t.dataset.rename), "update", { name }); toast("נשמר"); } catch (err) { toast(writeError(err)); } }
});
document.addEventListener("keydown", e => { if (e.key === "Escape" && form) { form = null; drawForm(); } });

/* ---------- shared-version events ---------- */
document.addEventListener("click", async e => {
  const el = e.target.closest("button"); if (!el) return;
  const d = el.dataset;
  if (d.pick) { const P = S.pick; P.days.has(d.pick) ? P.days.delete(d.pick) : P.days.add(d.pick); const y = window.scrollY; render(); window.scrollTo(0, y); return; }
  if (d.pmonth) { const [y, m] = S.pick.month.split("-").map(Number); const dt = new Date(y, m - 1 + Number(d.pmonth), 1); S.pick.month = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}`; render(); return; }
  switch (d.act) {
    case "pclearmonth": [...S.pick.days].filter(k => k.startsWith(S.pick.month)).forEach(k => S.pick.days.delete(k)); render(); return;
    case "editdays": startPick(); S.tab = "days"; render(); window.scrollTo(0, 0); return;
    case "savedays": S.settings = { ...S.settings, reserveDays: [...S.pick.days].sort() }; S.pick = null; S.tab = "settings"; onData(); toast("ימי המילואים נשמרו"); window.scrollTo(0, 0); return;
    case "canceldays": S.pick = null; S.tab = "settings"; render(); return;
    case "wiznext": {
      const W = S.wiz; if (W.step === 2) { if (!W.names.length) { W.err = "צריך להוסיף לפחות לוחם אחד."; render(); return; } W.err = ""; W.step = 3; if (!S.pick) startPick(); render(); window.scrollTo(0, 0); }
      return;
    }
    case "wizback": S.wiz.step = Math.max(1, S.wiz.step - 1); render(); window.scrollTo(0, 0); return;
    case "wizdone": {
      const W = S.wiz;
      S.team = { name: W.name, createdAt: Date.now() };
      S.soldiers = W.names.map((name, i) => ({ id: uid("s") + i, name, active: true, order: i + 1 }));
      S.absences = []; S.settings = { reserveDays: [...S.pick.days].sort(), minStrength: 15 };
      S.wiz = null; S.pick = null; S.tab = "cal"; onData(); window.scrollTo(0, 0); toast("הצוות מוכן"); return;
    }
    case "wizrestore": S.wiz.restore = !S.wiz.restore; render(); return;
    case "gobackup": S.tab = "settings"; render(); document.getElementById("backup")?.scrollIntoView(); return;
    case "download": {
      const blob = new Blob([JSON.stringify(snapshot(), null, 1)], { type: "application/json" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
      a.download = `matsevet-${todayKey()}.json`; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000); markBackedUp(); render(); toast("קובץ הגיבוי ירד"); return;
    }
    case "copycode": {
      const code = backupCode();
      try { await navigator.clipboard.writeText(code); S.backupCode = null; markBackedUp(); render(); toast("הקוד הועתק. שמרו אותו בוואטסאפ לעצמכם"); }
      catch { S.backupCode = code; markBackedUp(); render(); const b = document.getElementById("codebox"); if (b) { b.focus(); b.select(); } }
      return;
    }
    case "restorecode": offerRestore(document.getElementById("restoreCode")?.value); return;
    case "restorecancel": S.restore = null; S.restoreErr = ""; render(); return;
    case "restoreok": applyData(S.restore); S.restore = null; S.wiz = null; S.lastBackup = S.lastBackup || Date.now(); S.tab = "cal"; onData(); window.scrollTo(0, 0); toast("הנתונים שוחזרו"); return;
    case "reset":
      if (S.resetStep < 2) { S.resetStep++; render(); return; }
      clearTimeout(saveTimer); saveTimer = null;
      try { await docRef.delete(); } catch (err) { console.error(err); toast("המחיקה בענן נכשלה. נסו שוב."); return; }
      clearState(); render(); window.scrollTo(0, 0); return;
    case "login": signIn(); return;
    case "logout": secureSignOut(); return;
    case "migrate": applyData(S.localFound); S.localFound = null; S.wiz = null; S.tab = "cal"; onData(); try { localStorage.removeItem(KEY); } catch {} toast("הנתונים הועברו לענן"); return;
    case "skipmigrate": S.localFound = null; try { localStorage.removeItem(KEY); } catch {} render(); return;
    case "ics": {
      const blob = new Blob([icsText()], { type: "text/calendar;charset=utf-8" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "matsevet-reports.ics";
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast("נפתח קובץ יומן. מאשרים הוספה"); return;
    }
    case "resetcancel": S.resetStep = 0; render(); return;
  }
  if (d.wdel != null) { S.wiz.names.splice(Number(d.wdel), 1); render(); }
});
document.addEventListener("submit", e => {
  const id = e.target.id;
  if (id === "wiz1") { const v = document.getElementById("wName").value.trim(); if (!v) return; S.wiz.name = v; S.wiz.step = 2; render(); document.getElementById("wSoldier")?.focus(); }
  if (id === "wiz2add") {
    const inp = document.getElementById("wSoldier"); const v = inp.value.trim(); if (!v) return;
    S.wiz.names.push(v.slice(0, 60)); S.wiz.err = ""; render(); document.getElementById("wSoldier")?.focus();
  }
});

/* ---------- data ---------- */
function onData() { S.cache = null; persist(); render(); }
function init() {
  if (!FIREBASE_CONFIG.apiKey) { S.auth = "noconfig"; render(); return; }
  if (!window.firebase) { S.auth = "nosdk"; render(); return; }
  fb = firebase.initializeApp(FIREBASE_CONFIG);
  const isLocal = ["localhost", "127.0.0.1"].includes(location.hostname);
  if (APP_CHECK_SITE_KEY && !isLocal && firebase.appCheck) {
    try { fb.appCheck().activate(new firebase.appCheck.ReCaptchaEnterpriseProvider(APP_CHECK_SITE_KEY), true); } catch (e) { console.error("App Check", e); }
  }
  if (isLocal && new URLSearchParams(location.search).has("emulator")) {
    fb.auth().useEmulator("http://127.0.0.1:9099", { disableWarnings: true });
    fb.firestore().useEmulator("127.0.0.1", 8080);
  }
  fb.firestore().enablePersistence({ synchronizeTabs: true }).catch(() => {});
  fb.auth().getRedirectResult().catch(e => { if (e && e.code !== "auth/no-auth-event") { S.loginErr = "ההתחברות נכשלה. נסו שוב."; render(); } });
  fb.auth().onAuthStateChanged(attachUser);
  render();
}

/* ---------- attendance report ---------- */
function reportAt(t) {
  const key = keyOf(new Date(t)); const info = cache().info.get(key);
  if (!info) return null;
  const missing = [];
  for (const p of info.per) {
    const a = p.full || p.partial.find(x => ms(x.start) <= t && ms(x.end) > t);
    if (!a) continue;
    let text;
    if (a.type === "course") text = "קורס";
    else if (a.type === "nir") text = "לא במילואים";
    else {
      const endKey = a.end.slice(0, 10), why = [a.reason, a.note].filter(Boolean).join(", ");
      text = p.full ? "בבית" : `בבית עד ${endKey === key ? a.end.slice(11) : short(endKey) + " " + a.end.slice(11)}`;
      if (why) text += ` (${why})`;
    }
    missing.push({ name: p.sol.name, text });
  }
  return { key, t, total: info.total, present: info.total - missing.length, missing };
}
function reportText(r) {
  const d = new Date(r.t);
  const L = [`דיווח נוכחות${reportTitleSuffix()}`, `יום ${DOW[d.getDay()]} ${short(r.key)} · ${hm(r.t)}`, `נוכחים: ${r.present}/${r.total}`];
  if (!r.missing.length) L.push("לא נוכחים: אין");
  else { L.push("לא נוכחים:"); r.missing.forEach((m, i) => L.push(`${i + 1}. ${m.name} – ${m.text}`)); }
  return L.join("\n");
}
function viewReport() {
  const mode = S.repMode || "now";
  const tk = todayKey();
  const t = mode === "now" ? Math.floor(Date.now() / 60000) * 60000 : ms(`${tk}T${mode}`);
  const seg = `<div class="seg" role="group" aria-label="שעת הדיווח">${["now", ...reportTimes()].map(m => `<button type="button" data-rmode="${m}" aria-pressed="${mode === m}">${m === "now" ? "עכשיו" : m}</button>`).join("")}</div>`;
  const r = reportAt(t);
  if (!r) {
    const next = cache().days.find(k => k > tk);
    return `<div class="panel"><div class="row"><h2>דיווח דוח 1</h2>${seg}</div><div class="empty">היום לא יום מילואים, אז אין דיווח.${next ? `<br>יום המילואים הבא: ${longDate(next)}.` : ""}</div></div>`;
  }
  const text = reportText(r);
  S.reportCache = text;
  return `<div class="panel">
    <div class="row"><h2>דיווח דוח 1</h2>${seg}</div>
    <div class="big"><b class="${statusCls(r.present)}">${r.present}/${r.total}</b><span>נוכחים ב־${hm(r.t)} · ${longDate(r.key)}</span></div>
    <pre class="reportbox" id="reportbox">${esc(text)}</pre>
    <div class="actions"><a class="btn wa" href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">שליחה בוואטסאפ</a><button class="btn" data-act="copyreport">העתקה</button></div>
    <div class="muted" style="font-size:.85rem">"שליחה בוואטסאפ" פותח את וואטסאפ עם הדיווח מוכן. בוחרים למי לשלוח (אדם או קבוצה) ולוחצים שלח.</div>
  </div>`;
}
document.addEventListener("click", async e => {
  const el = e.target.closest("button"); if (!el) return;
  if (el.dataset.rmode) { S.repMode = el.dataset.rmode; render(); return; }
  if (el.dataset.act === "copyreport") {
    try { await navigator.clipboard.writeText(S.reportCache || ""); toast("הדיווח הועתק"); }
    catch { const b = document.getElementById("reportbox"); if (b) { const rg = document.createRange(); rg.selectNodeContents(b); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(rg); } toast("סמנו והעתיקו ידנית"); }
  }
});
function routeHash() { if (location.hash === "#report") { S.tab = "report"; S.repMode = "now"; render(); window.scrollTo(0, 0); } }
window.addEventListener("hashchange", routeHash);
if (location.hash === "#report") { S.tab = "report"; }

init();
