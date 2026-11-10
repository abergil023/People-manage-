// End-to-end security tests of the real app (docs/) with the real Firebase SDK against the
// Auth + Firestore emulators. Run with: npm run test:web  (starts the emulators itself).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

// APP_DIR: docs/staging (hardened version under test) or docs (production).
const ROOT = fileURLToPath(new URL(`../${process.env.APP_DIR || "docs/staging"}/`, import.meta.url));
const PORT = 5055, OTHER_PORT = 5056;
const APP = `http://127.0.0.1:${PORT}/index.html?emulator=1`;
let server, other, emu, browser;

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" };
function serveDocs(port) {
  return new Promise(res => {
    const s = createServer(async (req, resp) => {
      const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^\/+/, "") || "index.html";
      try {
        let body = await readFile(join(ROOT, path));
        if (path === "index.html") {
          // Same CSP as production, plus the local emulator endpoints.
          body = body.toString().replace("connect-src 'self'", "connect-src 'self' http://127.0.0.1:9099 http://127.0.0.1:8080")
            .replace("frame-src ", "frame-src http://127.0.0.1:9099 ");
        }
        resp.writeHead(200, { "content-type": TYPES[extname(path)] || "application/octet-stream" });
        resp.end(body);
      } catch { resp.writeHead(404); resp.end(); }
    });
    s.listen(port, "127.0.0.1", () => res(s));
  });
}
async function waitFor(url, ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { await fetch(url); return; } catch { await new Promise(r => setTimeout(r, 500)); } }
  throw new Error("emulator did not start: " + url);
}
async function newPage(ctx) {
  const page = await ctx.newPage();
  const problems = [];
  page.on("pageerror", e => problems.push("pageerror: " + e.message));
  page.on("console", m => { if (/Content Security Policy|Refused to/i.test(m.text())) problems.push("csp: " + m.text()); });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, body: "" }));
  return { page, problems };
}
// The Google popup itself needs Google's servers (not reachable in CI sandboxes), so tests sign in
// with a Google credential issued by the Auth emulator. Everything after sign-in is the real app code.
async function signIn(page, email) {
  await page.waitForSelector("[data-act=login]");
  await page.evaluate(async e => {
    const cred = firebase.auth.GoogleAuthProvider.credential(JSON.stringify({ sub: "google-" + e, email: e, email_verified: true }));
    await fb.auth().signInWithCredential(cred);
  }, email);
  await page.waitForSelector("#wiz1, .cell, .strip", { timeout: 20000 });
}
async function makeTeam(page, name, soldiers) {
  await page.fill("#wName", name); await page.press("#wName", "Enter");
  for (const n of soldiers) { await page.fill("#wSoldier", n); await page.press("#wSoldier", "Enter"); }
  await page.click("[data-act=wiznext]");
  await page.click("[data-pick]"); // first day of the shown month
  await page.click("[data-act=wizdone]");
  await page.waitForTimeout(1500); // debounce + server write
}

before(async () => {
  if (!process.env.EMULATORS_RUNNING) emu = spawn("npx", ["firebase", "emulators:start", "--only", "auth,firestore", "--project", "demo-matsevet"], { cwd: fileURLToPath(new URL("..", import.meta.url)), stdio: "ignore", detached: true });
  await waitFor("http://127.0.0.1:9099/"); await waitFor("http://127.0.0.1:8080/");
  // The app uses the real project id in its config; point the emulator project at it.
  // Start from an empty emulator state (the app's config uses project id "matsevet").
  for (const proj of ["matsevet", "demo-matsevet"]) {
    await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${proj}/databases/(default)/documents`, { method: "DELETE" }).catch(() => {});
    await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${proj}/accounts`, { method: "DELETE" }).catch(() => {});
  }
  server = await serveDocs(PORT); other = await serveDocs(OTHER_PORT);
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close(); server?.close(); other?.close();
  if (emu) { try { process.kill(-emu.pid, "SIGINT"); } catch {} await new Promise(r => setTimeout(r, 3000)); try { process.kill(-emu.pid, "SIGKILL"); } catch {} }
});

test("real sign-in + team creation works under the new rules and CSP", async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const { page, problems } = await newPage(ctx);
  await page.goto(APP);
  await signIn(page, "alice@example.com");
  await makeTeam(page, "צוות אליס", ["דני", "רועי"]);
  await page.reload(); await page.waitForSelector(".strip", { timeout: 20000 });
  assert.match(await page.textContent("#teamName"), /צוות אליס/, "team persisted in Firestore and reloaded");
  await page.click('[data-tab="report"]');
  assert.ok(await page.isVisible("#reportbox, .empty"));
  assert.deepEqual(problems, []);
  await ctx.close();
});

test("another user cannot see the first user's team", async () => {
  const ctx = await browser.newContext();
  const { page, problems } = await newPage(ctx);
  await page.goto(APP);
  await signIn(page, "bob@example.com");
  assert.ok(await page.isVisible("#wiz1"), "Bob starts with an empty wizard, not Alice's data");
  const leaked = await page.evaluate(() => document.body.innerText.includes("צוות אליס"));
  assert.equal(leaked, false);
  assert.deepEqual(problems, []);
  await ctx.close();
});

test("malicious backup code cannot inject script", async () => {
  const ctx = await browser.newContext();
  const { page } = await newPage(ctx);
  await page.goto(APP);
  await signIn(page, "carol@example.com");
  const evil = {
    team: { name: '<img src=x onerror="window.__pwned=1">' },
    soldiers: [{ id: '"><img src=x onerror="window.__pwned=2">', name: "x" }, { id: "ok1", name: '<script>window.__pwned=3</script>' }],
    absences: [{ id: 'x" onmouseover="window.__pwned=4', soldierId: "ok1", type: "home", reason: "<b>", note: "", allDay: true, start: "2026-11-16T00:00", end: "2026-11-17T00:00" }],
    settings: { reserveDays: ["2026-11-16"], minStrength: 1 },
  };
  const code = "MATSEVET1:" + Buffer.from(JSON.stringify(evil), "utf8").toString("base64");
  await page.click("[data-act=wizrestore]");
  await page.fill("#restoreCode", code);
  await page.click("[data-act=restorecode]");
  await page.click("[data-act=restoreok]");
  await page.waitForTimeout(1500);
  for (const tab of ["cal", "soldiers", "settings", "report"]) { await page.click(`[data-tab="${tab}"]`); await page.mouse.move(100, 300); }
  assert.equal(await page.evaluate(() => window.__pwned), undefined, "no injected script ran");
  const ids = await page.evaluate(() => S.soldiers.map(s => s.id));
  assert.deepEqual(ids, ["ok1"], "soldier with a malicious id was dropped");
  assert.equal(await page.evaluate(() => S.absences.length), 0, "absence with a malicious id was dropped");
  await ctx.close();
});

test("logout clears local copies of the data", async () => {
  const ctx = await browser.newContext();
  const { page } = await newPage(ctx);
  await page.goto(APP);
  await signIn(page, "dave@example.com");
  await makeTeam(page, "צוות דייב", ["אבי"]);
  await page.evaluate(() => localStorage.setItem("matsevet-team-v1", "{}"));
  await page.click('[data-tab="settings"]');
  await Promise.all([page.waitForNavigation(), page.click("[data-act=logout]")]);
  await page.waitForSelector("[data-act=login]", { timeout: 20000 });
  const dbs = await page.evaluate(async () => (await indexedDB.databases()).map(d => d.name).filter(n => /firestore/i.test(n) && !/main$|mutations/i.test("")));
  const hasMainCache = await page.evaluate(async () => (await indexedDB.databases()).some(d => /firestore\/\[DEFAULT\]\/matsevet\/main/.test(d.name)));
  assert.equal(hasMainCache, false, "Firestore offline cache was cleared: " + JSON.stringify(dbs));
  assert.equal(await page.evaluate(() => localStorage.getItem("matsevet-team-v1")), null);
  assert.equal(await page.evaluate(() => document.body.innerText.includes("צוות דייב")), false);
  await ctx.close();
});

test("app refuses to run inside a frame on another site (clickjacking)", async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  // Attacker page on another origin embeds the app.
  await page.goto(`http://127.0.0.1:${OTHER_PORT}/attacker-page`);
  await page.setContent(`<iframe id="f" src="${APP}" width="400" height="600"></iframe>`);
  await page.waitForTimeout(3000);
  if (page.url().includes(`:${PORT}/`)) return; // frame-busting navigated the top window away: attack defeated
  const frame = page.frames().find(f => f.url().includes(`:${PORT}/`));
  assert.ok(frame, "app frame exists");
  const shown = await frame.evaluate(() => getComputedStyle(document.body).display);
  assert.equal(shown, "none", "app body stays hidden inside a cross-origin frame");
  await ctx.close();
});

test("existing features still work end-to-end (absence, report, backup, reminders, reset)", async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const { page, problems } = await newPage(ctx);
  await page.goto(APP);
  await signIn(page, "erin@example.com");
  await makeTeam(page, "צוות ארין", ["דני", "רועי", "משה"]);
  const day = await page.getAttribute(".cell.res", "data-day");
  await page.click(`[data-day="${day}"]`);
  await page.click('[data-act="new"][data-date]');
  await page.selectOption("#fSoldier", { index: 1 });
  await page.click("#absForm button[type=submit]");
  await page.waitForTimeout(1500);
  await page.reload(); await page.waitForSelector(".strip", { timeout: 20000 });
  assert.match(await page.textContent(`[data-day="${day}"] .cnt`), /^2\/3/, "absence persisted and counted");
  assert.equal(await page.evaluate(d => reportAt(ms(d + "T10:00")).present, day), 2, "report 1 counts correctly");
  await page.click('[data-tab="settings"]');
  assert.ok(await page.isVisible("#reminders"), "optional reminders section still present");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("[data-act=download]")]);
  assert.ok(dl.suggestedFilename().endsWith(".json"), "backup download works");
  for (let i = 0; i < 3; i++) await page.click("[data-act=reset]");
  await page.waitForSelector("#wiz1", { timeout: 20000 });
  assert.deepEqual(problems, []);
  await ctx.close();
});
