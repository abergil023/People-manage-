"use strict";
// Read-only duty roster for the fighters. The data file is AES-256-GCM encrypted;
// the key is only in the link fragment (#k=...), which browsers never send to the server.
if (window.top !== window.self) { throw new Error("framed"); }
document.getElementById("antiClickjack").remove();

const app = document.getElementById("app");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ltr = s => "⁦" + s + "⁩";
const DOW = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
const dOf = k => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
const longDate = k => { const d = dOf(k); return `יום ${DOW[d.getDay()]}, ${d.getDate()} ב${MONTHS[d.getMonth()]}`; };
const short = k => { const d = dOf(k); return `${d.getDate()}.${d.getMonth() + 1}`; };
const P2 = n => String(n).padStart(2, "0");
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${P2(d.getMonth() + 1)}-${P2(d.getDate())}`; };
const TYPE = { post: "מוצב", patrol: "סיור", none: "ללא משימות" };
let DATA = null, ME = "";
try { ME = localStorage.getItem("roster-me") || ""; } catch {}

function fail(msg) { app.innerHTML = `<div class="err">${esc(msg)}</div>`; }
function keyFromHash() { const m = location.hash.match(/[#&]k=([A-Za-z0-9_-]{40,})/); return m ? m[1] : null; }
function b64(s) { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }

async function load() {
  const k = keyFromHash();
  if (!k) return fail("הקישור לא שלם. בקשו מהמפקד את הקישור המלא.");
  if (!window.crypto || !crypto.subtle) return fail("הדפדפן לא תומך בפתיחת השבצ״ק. נסו בדפדפן מעודכן (Chrome / Safari).");
  let enc;
  try { const r = await fetch("data.enc.json", { cache: "no-store" }); if (!r.ok) throw 0; enc = await r.json(); }
  catch { return fail("השבצ״ק עוד לא פורסם, או שאין חיבור. נסו שוב בעוד כמה דקות."); }
  try {
    const key = await crypto.subtle.importKey("raw", b64(k), "AES-GCM", false, ["decrypt"]);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(enc.iv) }, key, b64(enc.ct));
    DATA = JSON.parse(new TextDecoder().decode(pt));
  } catch { return fail("הקישור לא תקין או שהוחלף. בקשו מהמפקד את הקישור העדכני."); }
  const u = new Date(DATA.updatedAt);
  document.getElementById("upd").textContent = `צפייה בלבד · עודכן ${short(DATA.updatedAt.slice(0, 10))} ${P2(u.getHours())}:${P2(u.getMinutes())}`;
  render();
}
const chip = (n, free) => `<span class="chip${free ? " free" : ""}${ME && n === ME ? " me" : ""}">${esc(n)}</span>`;
function dayBody(d) {
  if (d.type === "none") return `<div class="muted">אין משימות ביום הזה.</div>`;
  let out = `<div class="row2"><span class="lbl">תורן מטבח</span><div class="chips">${d.kitchen ? chip(d.kitchen) : "—"}</div></div>`;
  for (const sh of d.shifts) out += `<div class="row2"><span class="lbl">${esc(sh.what)} ${ltr(`${sh.start.slice(11)}–${sh.end.slice(11)}`)}</span><div class="chips">${sh.names.map(chip).join("")}</div></div>`;
  if (d.hours.length) {
    out += `<div class="lbl">עמדה אחורית ומי ללא משימה (לפי שעה)</div><div class="htable"><div class="hrow head"><span>שעה</span><span>עמדה</span><span>ללא משימה</span></div>`;
    for (const h of d.hours) out += `<div class="hrow"><span class="num">${h.start.slice(11)}</span><span class="chips">${h.guards.map(chip).join("")}</span><span class="chips">${(h.free || h.inner || []).map(n => chip(n, true)).join("") || "—"}</span></div>`;
    out += `</div>`;
  }
  return out;
}
function mine(name) {
  const out = [];
  for (const d of DATA.days) {
    if (d.kitchen === name) out.push({ key: d.key, what: "תורן מטבח", s: d.start, e: d.start });
    for (const sh of d.shifts) if (sh.names.includes(name)) out.push({ key: d.key, what: sh.what, s: sh.start.slice(11), e: sh.end.slice(11), at: sh.start });
    for (const [f, what] of [["guards", "עמדה אחורית"]]) {
      let cur = null;
      for (const h of d.hours) {
        if ((h[f] || []).includes(name)) { const hh = h.start.slice(11), next = P2((+hh.slice(0, 2) + 1) % 24) + hh.slice(2); if (cur && cur.e === hh) cur.e = next; else { cur = { key: d.key, what, s: hh, e: next, at: h.start }; out.push(cur); } }
        else cur = null;
      }
    }
  }
  return out.sort((a, b) => (a.at || a.key + "T" + a.s).localeCompare(b.at || b.key + "T" + b.s));
}
function render() {
  const names = DATA.team || [];
  const tk = todayKey();
  let body;
  if (ME) {
    const list = mine(ME);
    body = `<div class="panel"><h2>המשימות של ${esc(ME)}</h2>${list.length ? `<ul class="list">${list.map(a => `<li class="item"><b>${esc(a.what)}</b><span class="muted">${DOW[dOf(a.key).getDay()]} ${short(a.key)} · ${ltr(`${a.s}–${a.e}`)}</span></li>`).join("")}</ul>` : `<div class="muted">אין משימות משובצות.</div>`}</div>`;
  } else {
    const firstOpen = DATA.days.find(d => d.key >= tk);
    body = DATA.days.map(d => `<details class="panel" ${firstOpen && d.key === firstOpen.key ? "open" : ""}><summary>${esc(longDate(d.key))} <span class="muted">· ${TYPE[d.type] || ""}</span></summary>${dayBody(d)}</details>`).join("") || `<div class="panel muted">אין עדיין ימים משובצים.</div>`;
  }
  app.innerHTML = `<div class="panel"><label for="me">המשימות שלי</label><select id="me"><option value="">כל הצוות, כל הימים</option>${names.map(n => `<option ${n === ME ? "selected" : ""}>${esc(n)}</option>`).join("")}</select></div>${body}`;
}
document.addEventListener("change", e => { if (e.target.id === "me") { ME = e.target.value; try { localStorage.setItem("roster-me", ME); } catch {} render(); } });
window.addEventListener("hashchange", load);
load();
