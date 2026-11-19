// Tests for the fighters' open link: tools/publish-roster.mjs + docs/roster (decrypt in the browser).
// Run with: node --test tests/roster.test.mjs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, copyFileSync } from "node:fs";
import { join, extname } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { webcrypto as crypto } from "node:crypto";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const html = readFileSync(join(ROOT, "index.html"), "utf8");
const code = html.slice(html.indexOf("/* ==== SCHEDULER ENGINE START ==== */"), html.indexOf("/* ==== SCHEDULER ENGINE END ==== */"));
const ctx = {}; vm.createContext(ctx); vm.runInContext(code + "\nthis.SCHED = SCHED;", ctx);
const S = ctx.SCHED;

const NAMES = ["אברג׳יל", "יואב", "מארק", "ממן", "שאער", "דין", "הררי", "צבי", "תום", "מתניה", "גילמור", "רוזמן", "מאור", "סשה", "עירן", "עירוני", "גייבל", "אביאל"];
const R = { commander: ["ממן", "אברג׳יל", "אביאל", "מתניה", "עירוני"], davidDriver: ["צבי", "שאער", "הררי", "מארק"], tigrisDriver: ["שאער", "יואב"], carmelALead: ["אברג׳יל", "אביאל"] };
const soldiers = NAMES.map((n, i) => ({ id: "s" + String(i + 1).padStart(2, "0"), name: n, active: true, order: i + 1, roles: Object.keys(R).filter(r => R[r].includes(n)) }));
const SECRET_NOTE = "ניתוח-סודי-בבית-חולים";
const absences = [{ id: "a1", soldierId: "s09", type: "home", reason: "מחלה", note: SECRET_NOTE, allDay: true, start: "2026-11-21T00:00", end: "2026-11-22T00:00" }];
const days = ["2026-11-20", "2026-11-21", "2026-11-22"];
const key = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");

let dir, out, server, browser, port = 5077;
const run = () => execFileSync(process.execPath, [join(ROOT, "tools/publish-roster.mjs"), "--db", dir, "--out", out], { encoding: "utf8" }).trim();
async function decrypt(file, k = key) {
  const enc = JSON.parse(readFileSync(file, "utf8"));
  const ck = await crypto.subtle.importKey("raw", Buffer.from(k, "base64url"), "AES-GCM", false, ["decrypt"]);
  return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: Buffer.from(enc.iv, "base64") }, ck, Buffer.from(enc.ct, "base64"))));
}

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "rosterdb-"));
  for (const sub of ["schedule", "soldiers", "settings", "secret", "absences"]) mkdirSync(join(dir, sub));
  const { docs } = S.buildAll({ soldiers, absences, days, dayTypes: { "2026-11-22": "patrol" }, now: 0 }, {}, "rebuild");
  for (const [k, d] of Object.entries(docs)) writeFileSync(join(dir, "schedule", k + ".json"), JSON.stringify(d));
  for (const s of soldiers) writeFileSync(join(dir, "soldiers", s.id + ".json"), JSON.stringify({ name: s.name, active: true, order: s.order, roles: s.roles }));
  for (const a of absences) writeFileSync(join(dir, "absences", a.id + ".json"), JSON.stringify(a)); // present in the export dir, must never be published
  writeFileSync(join(dir, "settings", "main.json"), JSON.stringify({ minStrength: 15, reserveRanges: [{ from: "2026-11-20", to: "2026-11-22" }] }));
  writeFileSync(join(dir, "secret", "publicLink.json"), JSON.stringify({ key }));
  // site copy with its own data file
  const site = mkdtempSync(join(tmpdir(), "rostersite-"));
  for (const f of ["index.html", "roster.js"]) copyFileSync(join(ROOT, "docs/roster", f), join(site, f));
  out = join(site, "data.enc.json");
  server = createServer((req, res) => {
    const p = new URL(req.url, "http://x").pathname.replace(/^\/+/, "") || "index.html";
    try { const b = readFileSync(join(site, p)); res.writeHead(200, { "content-type": { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json" }[extname(p)] || "text/plain" }); res.end(b); }
    catch { res.writeHead(404); res.end(); }
  }).listen(port, "127.0.0.1");
});
after(async () => { await browser?.close(); server?.close(); rmSync(dir, { recursive: true, force: true }); });

test("publish: encrypted output, names + assignments only, nothing about absences/roles", async () => {
  assert.equal(run(), "changed");
  const raw = readFileSync(out, "utf8");
  for (const w of ["תום", "מחלה", SECRET_NOTE, "commander", "s09"]) assert.ok(!raw.includes(w), `ciphertext file must not contain "${w}"`);
  const data = await decrypt(out);
  const text = JSON.stringify(data);
  for (const w of ["מחלה", SECRET_NOTE, "reason", "note", "roles", "commander", "soldierId", "absences", key]) assert.ok(!text.includes(w), `published content must not contain "${w}"`);
  assert.equal(data.days.length, 3);
  assert.equal(data.days[2].type, "patrol");
  assert.equal(data.days[0].shifts[0].names.length, 8);
  assert.ok(data.days[0].hours.some(h => h.guards.length === 2), "night hours have 2 guards");
  assert.ok(data.team.includes("סשה"));
});

test("publish again without changes -> unchanged; after a change -> changed", () => {
  assert.equal(run(), "unchanged");
  const f = join(dir, "schedule", "2026-11-21.json");
  const d = JSON.parse(readFileSync(f, "utf8")); d.kitchen = d.kitchen === "s14" ? "s15" : "s14"; writeFileSync(f, JSON.stringify(d));
  assert.equal(run(), "changed");
});

test("wrong key cannot decrypt", async () => {
  const other = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  await assert.rejects(decrypt(out, other));
});

test("page: correct link shows the roster; wrong / missing key shows an error and no data", async () => {
  const { chromium } = await import("playwright");
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (/Content Security Policy|Refused/.test(m.text())) errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${port}/#k=${key}`);
  await page.waitForSelector("details, .err", { timeout: 10000 });
  const body = await page.evaluate(() => document.body.innerText);
  assert.ok(body.includes("כרמל חוץ מוצב") && body.includes("סשה"), "roster visible");
  assert.ok(!body.includes(SECRET_NOTE) && !body.includes("מחלה"));
  await page.selectOption("#me", "סשה");
  assert.ok((await page.$$(".item")).length > 0, "my missions listed");
  assert.deepEqual(errors, []);
  const bad = await browser.newPage();
  await bad.goto(`http://127.0.0.1:${port}/#k=${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")}`);
  await bad.waitForSelector(".err");
  assert.match(await bad.textContent(".err"), /לא תקין/);
  assert.ok(!(await bad.evaluate(() => document.body.innerText)).includes("סשה"));
  const none = await browser.newPage();
  await none.goto(`http://127.0.0.1:${port}/`);
  await none.waitForSelector(".err");
  assert.match(await none.textContent(".err"), /לא שלם/);
});
