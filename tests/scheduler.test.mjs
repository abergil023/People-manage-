// Unit tests for the duty-roster engine embedded in index.html (between the SCHEDULER ENGINE markers).
// Run with: node --test tests/scheduler.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const code = html.slice(html.indexOf("/* ==== SCHEDULER ENGINE START ==== */"), html.indexOf("/* ==== SCHEDULER ENGINE END ==== */"));
const ctx = {}; vm.createContext(ctx); vm.runInContext(code + "\nthis.SCHED = SCHED;", ctx);
const S = ctx.SCHED;

const NAMES = "אברג׳יל יואב מארק ממן שאער דין הררי צבי תום מתניה גילמור רוזמן מאור סשה עירן עירוני גייבל אביאל".split(" ");
const ROLES = {
  commander: ["ממן", "אברג׳יל", "אביאל", "מתניה", "עירוני"],
  davidDriver: ["צבי", "שאער", "הררי", "מארק"],
  tigrisDriver: ["שאער", "יואב"],
  carmelALead: ["אברג׳יל", "אביאל"],
};
const soldiers = NAMES.map((n, i) => ({ id: "s" + String(i + 1).padStart(2, "0"), name: n, active: true, roles: Object.keys(ROLES).filter(r => ROLES[r].includes(n)) }));
const idOf = n => soldiers.find(s => s.name === n).id;
const RANGES = [["2026-11-11", "2026-11-12"], ["2026-11-15", "2026-11-23"], ["2026-11-29", "2026-12-08"], ["2026-12-15", "2026-12-20"], ["2026-12-23", "2026-12-24"]];
const days = []; for (const [a, b] of RANGES) for (let k = a; k <= b; k = S.plusDays(k, 1)) days.push(k);
const mixedTypes = Object.fromEntries(days.map((k, i) => [k, i % 3 === 2 ? "patrol" : "post"]));
const T = S.T, H = S.HOUR;
const total = o => Object.values(o).reduce((n, l) => n + l.length, 0);

function randomAbsences(seed) {
  let x = seed; const rnd = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
  const out = [];
  for (const s of soldiers) for (let j = 0; j < 2; j++) {
    const k = days[Math.floor(rnd() * days.length)];
    if (rnd() < 0.5) out.push({ soldierId: s.id, start: `${k}T00:00`, end: `${S.plusDays(k, 1)}T00:00` });
    else { const h = 8 + Math.floor(rnd() * 10); out.push({ soldierId: s.id, start: `${k}T${String(h).padStart(2, "0")}:00`, end: `${k}T${String(h + 6).padStart(2, "0")}:00` }); }
  }
  return out;
}
// Is every reported problem genuinely unavoidable (role holders all absent / not enough people)?
function onlyUnavoidable(input, docs, problems) {
  const absentAt = (id, t0, t1) => input.absences.some(a => a.soldierId === id && T(a.start) < t1 && T(a.end) > t0);
  for (const [k, list] of Object.entries(problems)) for (const p of list) {
    const d = docs[k];
    const m = p.match(/^(כרמל א׳|סיור) (\d\d:\d\d): חסר (.+)$/);
    if (m) {
      const sh = d.shifts.find(x => x.start.endsWith(m[2]));
      const role = { "אברג׳יל/אביאל": "carmelALead", "נהג טיגריס": "tigrisDriver", "מפקד": "commander", "נהג דוד": "davidDriver" }[m[3]];
      const free = soldiers.filter(s => s.roles.includes(role) && !absentAt(s.id, T(sh.start), T(sh.end)));
      if (free.length) return `avoidable: ${k} ${p} (free: ${free.map(s => s.name)})`;
      continue;
    }
    const m2 = p.match(/^שעה (\d\d:\d\d): בכרמל ב׳ חסרים/);
    if (m2) {
      const h = d.hours.find(x => x.start.endsWith(m2[1])); const t0 = T(h.start);
      const present = soldiers.filter(s => !absentAt(s.id, t0, t0 + H)).length;
      if (present >= 13) return `avoidable: ${k} ${p} (present ${present})`;
      continue;
    }
    return `unexpected problem: ${k} ${p}`;
  }
  return null;
}

test("no absences: every rule holds on every day (post and patrol)", () => {
  const input = { soldiers, absences: [], days, dayTypes: mixedTypes, now: 0 };
  const { docs } = S.buildAll(input, {}, "rebuild");
  assert.equal(total(S.validate(input, docs)), 0);
  for (const k of days) {
    const d = docs[k];
    if (d.type === "post") {
      assert.equal(d.shifts.length, 2); assert.equal(d.hours.length, 24);
      for (const sh of d.shifts) assert.equal(sh.members.length, 8);
      for (const h of d.hours) { assert.ok(h.guard); assert.equal(h.carmelB.length, 4); }
    } else {
      assert.equal(d.shifts.length, 3);
      for (const sh of d.shifts) assert.equal(sh.members.length, 7);
    }
    assert.ok(d.kitchen);
  }
});

test("with random absences (40 scenarios) only genuinely impossible slots are reported", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const input = { soldiers, absences: randomAbsences(seed), days, dayTypes: mixedTypes, now: 0 };
    const { docs } = S.buildAll(input, {}, "rebuild");
    const bad = onlyUnavoidable(input, docs, S.validate(input, docs));
    assert.equal(bad, null, `seed ${seed}: ${bad}`);
  }
});

test("hard rules: kitchen duty never guards / patrols / sits in carmel A; nobody double-booked", () => {
  const input = { soldiers, absences: randomAbsences(3), days, dayTypes: mixedTypes, now: 0 };
  const { docs } = S.buildAll(input, {}, "rebuild");
  for (const k of days) {
    const d = docs[k];
    for (const sh of d.shifts) assert.ok(!sh.members.includes(d.kitchen), `${k} kitchen in ${sh.kind}`);
    for (const h of d.hours) {
      assert.notEqual(h.guard, d.kitchen);
      const A = d.shifts.find(x => T(x.start) <= T(h.start) && T(x.end) > T(h.start)).members;
      assert.ok(!A.includes(h.guard)); assert.ok(!h.carmelB.includes(h.guard));
      assert.ok(h.carmelB.every(id => !A.includes(id)));
    }
  }
});

test("fairness: total load is spread evenly across the team", () => {
  const input = { soldiers, absences: [], days, dayTypes: mixedTypes, now: 0 };
  const { stats } = S.buildAll(input, {}, "rebuild");
  const loads = soldiers.map(s => stats[s.id].load);
  const avg = loads.reduce((a, b) => a + b, 0) / loads.length;
  assert.ok(Math.max(...loads) - Math.min(...loads) <= avg * 0.2, `spread ${Math.min(...loads)}..${Math.max(...loads)} avg ${avg}`);
  const guards = soldiers.map(s => stats[s.id].guard);
  assert.ok(Math.max(...guards) - Math.min(...guards) <= 10, `guard spread ${guards}`);
});

test("repair of a valid roster changes nothing (stable, no write loops)", () => {
  const input = { soldiers, absences: randomAbsences(5), days, dayTypes: mixedTypes, now: 0 };
  const { docs } = S.buildAll(input, {}, "rebuild");
  const again = S.buildAll(input, JSON.parse(JSON.stringify(docs)), "repair").docs;
  assert.equal(JSON.stringify(again), JSON.stringify(docs));
});

test("new absence: soldier is replaced only where needed, past slots untouched, locks kept", () => {
  const dt = Object.fromEntries(days.map(k => [k, "post"]));
  const input = { soldiers, absences: [], days, dayTypes: dt, now: T("2026-11-16T12:00") };
  const { docs } = S.buildAll(input, {}, "rebuild");
  const k = "2026-11-17";
  const victim = docs[k].shifts[0].members.find(id => !soldiers.find(s => s.id === id).roles.length);
  // lock someone else in that shift
  const lockedId = docs[k].shifts[0].members.find(id => id !== victim);
  docs[k].shifts[0].locked = [lockedId];
  const pastBefore = JSON.stringify(docs["2026-11-15"]);
  const input2 = { ...input, absences: [{ soldierId: victim, start: `${k}T00:00`, end: `${S.plusDays(k, 1)}T00:00` }] };
  const after = S.buildAll(input2, JSON.parse(JSON.stringify(docs)), "repair").docs;
  assert.ok(!after[k].shifts[0].members.includes(victim), "victim removed");
  assert.equal(after[k].shifts[0].members.length, 8, "slot refilled");
  assert.ok(after[k].shifts[0].members.includes(lockedId), "locked member kept");
  assert.equal(JSON.stringify(after["2026-11-15"]), pastBefore, "past day unchanged");
  // only days touching the victim changed
  const changed = days.filter(d => JSON.stringify(after[d]) !== JSON.stringify(docs[d]));
  assert.ok(changed.length <= 3, `changed days: ${changed}`);
  assert.equal(total(S.validate(input2, after)), 0);
});

test("both carmel-A leads absent -> clear warning instead of a silent bad roster", () => {
  const k = "2026-11-18";
  const absences = ["אברג׳יל", "אביאל"].map(n => ({ soldierId: idOf(n), start: `${k}T00:00`, end: `${S.plusDays(k, 1)}T12:00` }));
  const input = { soldiers, absences, days, dayTypes: {}, now: 0 };
  const { docs } = S.buildAll(input, {}, "rebuild");
  const p = S.validate(input, docs)[k];
  assert.ok(p.some(x => x.includes("חסר אברג׳יל/אביאל")), JSON.stringify(p));
});

test("day type 'none' has no missions; assignmentsOf lists a soldier's missions", () => {
  const k = days[0];
  const input = { soldiers, absences: [], days, dayTypes: { [k]: "none" }, now: 0 };
  const { docs } = S.buildAll(input, {}, "rebuild");
  assert.equal(docs[k].shifts.length, 0); assert.equal(docs[k].kitchen, null);
  const mine = S.assignmentsOf(docs, idOf("תום"));
  assert.ok(mine.length > 0 && mine.every(a => a.start < a.end));
});

test("first build in the middle of the rotation does not invent rosters for days already over", () => {
  const input = { soldiers, absences: [], days, dayTypes: {}, now: T("2026-11-19T13:30") };
  const { docs } = S.buildAll(input, {}, "rebuild");
  assert.ok(!docs["2026-11-17"], "past day not built");
  assert.ok(docs["2026-11-19"] && docs["2026-11-20"], "today and future built");
});

/* ---------- manual editing that ripples through the roster ---------- */
function setup(nowStr) {
  const dt = Object.fromEntries(days.map(k => [k, "post"]));
  const input = { soldiers, absences: [], days, dayTypes: dt, now: T(nowStr) };
  const { docs } = S.buildAll(input, {}, "rebuild");
  return { input, docs };
}
const slotsHeld = (d, id) => S.slotsOf(null, d).length; // placeholder (unused)
function heldBy(key, d, id) { return S.slotsOf(key, d).filter(sl => S.holders(d, sl.ref).includes(id)); }

test("replace X by a busy Y for the whole day: Y takes X's slots, Y's old slots are refilled, rest rebalanced", () => {
  const { input, docs } = setup("2026-11-20T09:00");
  const k = "2026-11-21";
  const d = docs[k];
  const X = d.shifts[0].members.find(id => !soldiers.find(s => s.id === id).roles.length);
  const Y = d.shifts[1].members.find(id => !soldiers.find(s => s.id === id).roles.length); // busy in the other shift
  const xSlots = heldBy(k, d, X).map(s => s.ref);
  const edited = S.replaceInDay(k, d, X, Y, input.now);
  const after = S.buildAll(input, { ...docs, [k]: edited }, "repair", { rebuildAfter: k }).docs;
  const nd = after[k];
  for (const ref of xSlots) assert.ok(S.holders(nd, ref).includes(Y), `Y in ${ref}`);
  assert.equal(heldBy(k, nd, X).filter(sl => xSlots.includes(sl.ref)).length, 0, "X out of his old slots");
  assert.ok(!nd.shifts[1].members.includes(Y), "Y left his conflicting shift");
  assert.equal(nd.shifts[1].members.length, 8, "Y's old shift refilled");
  assert.ok(nd.shifts[0].locked.includes(Y), "Y locked");
  assert.equal(total(S.validate(input, after)), 0, JSON.stringify(S.validate(input, after)));
  for (const key of days.filter(x => x < k)) assert.equal(JSON.stringify(after[key]), JSON.stringify(docs[key]), `day before unchanged: ${key}`);
  // stable afterwards (no write loop)
  assert.equal(JSON.stringify(S.buildAll(input, after, "repair").docs), JSON.stringify(after));
});

test("replacing the Tigris driver with a non-driver keeps a Tigris driver in the shift", () => {
  const { input, docs } = setup("2026-11-20T09:00");
  const k = "2026-11-22", d = docs[k];
  const i = d.shifts.findIndex(sh => sh.members.some(id => soldiers.find(s => s.id === id).roles.includes("tigrisDriver")));
  const X = d.shifts[i].members.find(id => soldiers.find(s => s.id === id).roles.includes("tigrisDriver"));
  const Y = soldiers.find(s => !s.roles.length && !d.shifts[i].members.includes(s.id)).id;
  const after = S.buildAll(input, { ...docs, [k]: S.replaceInDay(k, d, X, Y, input.now) }, "repair", { rebuildAfter: k }).docs;
  const sh = after[k].shifts[i];
  assert.ok(sh.members.includes(Y));
  assert.ok(sh.members.some(id => soldiers.find(s => s.id === id).roles.includes("tigrisDriver")), "a Tigris driver is still there");
  assert.equal(sh.members.length, 8);
  assert.equal(total(S.validate(input, after)), 0);
});

test("move from carmel B to the rear position: guard set and locked, previous guard freed, carmel B still 4 with a commander", () => {
  const { input, docs } = setup("2026-11-20T09:00");
  const k = "2026-11-21", d = docs[k];
  const hi = 4, h = d.hours[hi];
  const X = h.carmelB.find(id => !soldiers.find(s => s.id === id).roles.includes("commander"));
  const oldGuard = h.guard;
  const edited = S.moveInDay(k, d, `b|${hi}`, `g|${hi}`, X, input.now);
  const after = S.buildAll(input, { ...docs, [k]: edited }, "repair", { rebuildAfter: k }).docs;
  const nh = after[k].hours[hi];
  assert.equal(nh.guard, X); assert.ok(nh.guardLocked);
  assert.ok(!nh.carmelB.includes(X));
  assert.equal(nh.carmelB.length, 4);
  assert.ok(nh.carmelB.some(id => soldiers.find(s => s.id === id).roles.includes("commander")));
  assert.notEqual(nh.guard, oldGuard);
  assert.equal(total(S.validate(input, after)), 0);
});

test("editing today while it runs: finished slots untouched, running shift kept full", () => {
  const { input, docs } = setup("2026-11-21T10:15");
  const k = "2026-11-21", d = docs[k];
  const X = d.shifts[0].members.find(id => !soldiers.find(s => s.id === id).roles.length);
  const Y = d.shifts[1].members.find(id => !soldiers.find(s => s.id === id).roles.length);
  const after = S.buildAll(input, { ...docs, [k]: S.replaceInDay(k, d, X, Y, input.now) }, "repair", { rebuildAfter: k }).docs;
  const nd = after[k];
  for (let i = 0; i < 3; i++) assert.equal(JSON.stringify(nd.hours[i]), JSON.stringify(d.hours[i]), `finished hour ${i} unchanged`);
  assert.ok(nd.shifts[0].members.includes(Y) && !nd.shifts[0].members.includes(X));
  assert.equal(nd.shifts[0].members.length, 8); assert.equal(nd.shifts[1].members.length, 8);
  assert.equal(total(S.validate(input, after)), 0, JSON.stringify(S.validate(input, after)[k]));
});

test("move into a full group trims the most loaded unlocked member; diffDay reports the change", () => {
  const { input, docs } = setup("2026-11-20T09:00");
  const k = "2026-11-21", d = docs[k];
  const X = d.hours[10].guard; // rear-position guard moves into carmel B (full)
  const edited = S.moveInDay(k, d, "g|10", "b|10", X, input.now);
  const after = S.buildAll(input, { ...docs, [k]: edited }, "repair", { rebuildAfter: k }).docs;
  assert.equal(after[k].hours[10].carmelB.length, 4);
  assert.ok(after[k].hours[10].carmelB.includes(X));
  assert.ok(after[k].hours[10].guard && after[k].hours[10].guard !== X, "new guard assigned");
  const diff = S.diffDay(k, d, after[k]);
  assert.ok(diff[X] && diff[X].added.length && diff[X].removed.length);
  assert.equal(total(S.validate(input, after)), 0);
});

test("60 random edits (replace / move) keep the roster valid and stable", () => {
  let x = 11; const rnd = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = a => a[Math.floor(rnd() * a.length)];
  const input = { soldiers, absences: [], days, dayTypes: mixedTypes, now: T("2026-11-20T09:00") };
  let docs = S.buildAll(input, {}, "rebuild").docs;
  const future = days.filter(k => S.dayWindow(k)[1] > input.now);
  for (let n = 0; n < 60; n++) {
    const k = pick(future), d = docs[k];
    const slots = S.slotsOf(k, d).filter(sl => sl.t1 > input.now && S.holders(d, sl.ref).length);
    const sl = pick(slots); const X = pick(S.holders(d, sl.ref));
    let edited;
    if (rnd() < 0.5) edited = S.replaceInDay(k, d, X, pick(soldiers.filter(s => s.id !== X)).id, input.now);
    else {
      const targets = S.slotsOf(k, d).filter(t => t.t1 > input.now && t.ref !== sl.ref);
      edited = S.moveInDay(k, d, sl.ref, pick(targets).ref, X, input.now);
    }
    docs = S.buildAll(input, { ...docs, [k]: edited }, "repair", { rebuildAfter: k }).docs;
    const problems = Object.values(S.validate(input, docs)).flat();
    // locks can legitimately make a rule impossible (e.g. all commanders locked elsewhere); never a double booking
    assert.ok(!problems.some(p => /בו־זמנית|משובץ פעמיים|גם ב|תורן המטבח (שומר|משובץ)|השומר/.test(p)), `edit ${n} (${k}): ${problems.join(" | ")}`);
  }
  assert.equal(JSON.stringify(S.buildAll(input, docs, "repair").docs), JSON.stringify(docs), "stable after edits");
});
