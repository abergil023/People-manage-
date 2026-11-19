#!/usr/bin/env node
// Builds the public, encrypted duty roster for the fighters' open link.
//
// Usage:
//   node tools/publish-roster.mjs --db <dir> --out docs/roster/data.enc.json
//
// <dir> holds the private app's database as exported by ArtifactData (out_dir), one JSON file per document:
//   <dir>/schedule/<YYYY-MM-DD>.json   roster days
//   <dir>/soldiers/<id>.json           fighters (only the name is published)
//   <dir>/settings/main.json           reserve ranges (only listed days are published)
//   <dir>/secret/publicLink.json       { key }  (base64url, 32 bytes; never written to the output)
//
// The output contains ONLY names and assignments: no absences, reasons, roles or notes.
// It is encrypted with AES-256-GCM; the key lives only in the link fragment (#k=...).
// Exit code 0. Prints "changed" when the file was (re)written, "unchanged" otherwise.
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { webcrypto as crypto } from "node:crypto";

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith("--") ? [...a, [v.slice(2), all[i + 1]]] : a), []));
if (!args.db || !args.out) { console.error("usage: --db <dir> --out <file>"); process.exit(2); }

const readDir = sub => { const d = join(args.db, sub); return existsSync(d) ? Object.fromEntries(readdirSync(d).filter(f => f.endsWith(".json")).map(f => [f.slice(0, -5), JSON.parse(readFileSync(join(d, f), "utf8"))])) : {}; };
const unwrap = x => (x && typeof x === "object" && x.data && typeof x.data === "object" && !x.type && !x.name ? x.data : x);
const schedule = Object.fromEntries(Object.entries(readDir("schedule")).map(([k, v]) => [k, unwrap(v)]));
const soldiers = Object.fromEntries(Object.entries(readDir("soldiers")).map(([k, v]) => [k, unwrap(v)]));
const settingsMain = unwrap(readDir("settings").main || {});
const secret = unwrap(readDir("secret").publicLink || {});
if (!secret.key) { console.error("no secret/publicLink key - create the link in the app first"); process.exit(3); }

const P2 = n => String(n).padStart(2, "0");
const kOf = d => `${d.getFullYear()}-${P2(d.getMonth() + 1)}-${P2(d.getDate())}`;
const plusDays = (k, n) => { const [y, m, d] = k.split("-").map(Number); return kOf(new Date(y, m - 1, d + n)); };
const reserve = new Set();
for (const r of settingsMain.reserveRanges || []) if (r.from && r.to) for (let k = r.from; k <= r.to; k = plusDays(k, 1)) reserve.add(k);

const name = id => (soldiers[id] && typeof soldiers[id].name === "string" ? soldiers[id].name : "—");
const LABEL = { carmelA: "כרמל חוץ מוצב", patrol: "סיור" };
const days = Object.keys(schedule).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k) && (!reserve.size || reserve.has(k))).sort().map(key => {
  const d = schedule[key] || {};
  const start = d.startAt ? String(d.startAt).slice(11, 16) : d.v === 2 ? "07:00" : "06:30"; // a day may start late (e.g. 15:00)
  return {
    key, type: ["post", "patrol"].includes(d.type) ? d.type : "none", start,
    kitchen: d.kitchen ? name(d.kitchen) : null,
    shifts: (d.shifts || []).map(sh => ({ what: LABEL[sh.kind] || "", start: String(sh.start || ""), end: String(sh.end || ""), names: (sh.members || []).map(name) })),
    hours: (d.hours || []).map(h => ({ start: String(h.start || ""), guards: (Array.isArray(h.guards) ? h.guards : h.guard ? [h.guard] : []).map(name), inner: (h.carmelB || []).map(name) })),
  };
});
const team = Object.values(soldiers).filter(s => s && s.active !== false).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map(s => s.name);
const content = { days, team };

const b64 = u8 => Buffer.from(u8).toString("base64");
const fromB64url = s => Uint8Array.from(Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64"));
const key = await crypto.subtle.importKey("raw", fromB64url(secret.key), "AES-GCM", false, ["encrypt", "decrypt"]);

// unchanged? (compare decrypted previous content, ignoring the timestamp)
if (existsSync(args.out)) {
  try {
    const prev = JSON.parse(readFileSync(args.out, "utf8"));
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: Buffer.from(prev.iv, "base64") }, key, Buffer.from(prev.ct, "base64"));
    const old = JSON.parse(new TextDecoder().decode(pt));
    if (JSON.stringify({ days: old.days, team: old.team }) === JSON.stringify(content)) { console.log("unchanged"); process.exit(0); }
  } catch { /* different key (link replaced) or unreadable -> rewrite */ }
}
const iv = crypto.getRandomValues(new Uint8Array(12));
const plain = new TextEncoder().encode(JSON.stringify({ updatedAt: new Date().toISOString(), ...content }));
const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain));
writeFileSync(args.out, JSON.stringify({ v: 1, alg: "A256GCM", iv: b64(iv), ct: b64(ct) }) + "\n");
console.log("changed");
