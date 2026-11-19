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
const role = (id, r) => soldiers.find(s => s.id === id).roles.includes(r);
const RANGES = [["2026-11-11", "2026-11-12"], ["2026-11-15", "2026-11-23"], ["2026-11-29", "2026-12-08"], ["2026-12-15", "2026-12-20"], ["2026-12-23", "2026-12-24"]];
const days = []; for (const [a, b] of RANGES) for (let k = a; k <= b; k = S.plusDays(k, 1)) days.push(k);
const mixedTypes = Object.fromEntries(days.map((k, i) => [k, i % 3 === 2 ? "patrol" : "post"]));
const allPost = Object.fromEntries(days.map(k => [k, "post"]));
const T = S.T, H = S.HOUR;
const hourOf = t => new Date(t).getHours();
const same = (a, b, m) => assert.equal(JSON.stringify(a), JSON.stringify(b), m); // engine runs in another realm
const total = o => Object.values(o).reduce((n, l) => n + l.length, 0);
const absentAt = (abs, id, t0, t1) => abs.some(a => a.soldierId === id && T(a.start) < t1 && T(a.end) > t0);

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
// Is every reported problem genuinely unavoidable (role holders absent / not enough people present)?
function onlyUnavoidable(input, docs, problems) {
  const label2role = { "אברג׳יל/אביאל": "carmelALead", "נהג טיגריס": "tigrisDriver", "מפקד": "commander", "נהג דוד": "davidDriver" };
  for (const [k, list] of Object.entries(problems)) for (const p of list) {
    const d = docs[k];
    const m = p.match(/^(כרמל חוץ מוצב|סיור) (\d\d:\d\d): (?:חסר|חסרים (\d+)) (.+)$/);
    if (m && label2role[m[4]]) {
      const sh = d.shifts.find(x => x.start.endsWith(m[2])), r = label2role[m[4]];
      const need = { commander: sh.kind === "patrol" ? 2 : 1, davidDriver: 2 }[r] || 1;
      const freeHolders = soldiers.filter(s => s.roles.includes(r) && !absentAt(input.absences, s.id, T(sh.start), T(sh.end)) && s.id !== d.kitchen);
      // the other shift of the day may legitimately need the same scarce holders
      const other = d.shifts.find(x => x !== sh);
      const otherNeeds = other ? (({ commander: other.kind === "patrol" ? 2 : 0, davidDriver: other.kind === "patrol" ? 2 : 0, carmelALead: 1, tigrisDriver: other.kind === "carmelA" ? 1 : 0 })[r] || 0) : 0;
      const usable = freeHolders.filter(s => !other || !other.members.includes(s.id) || freeHolders.length > need + otherNeeds);
      if (usable.length >= need + (sh.kind === "patrol" && r === "commander" ? 0 : 0) && freeHolders.length >= need + otherNeeds) return `avoidable: ${k} ${p} (free: ${freeHolders.map(s => s.name)})`;
      continue;
    }
    const m2 = p.match(/^שעה (\d\d:\d\d): (חסר שומר|חסרים \d+ שומרים)/);
    if (m2) {
      const h = d.hours.find(x => x.start.endsWith(m2[1])); const t0 = T(h.start);
      const present = soldiers.filter(s => !absentAt(input.absences, s.id, t0, t0 + H));
      const hs = S.hourSpec(t0, S.V);
      // 8 outer post + guards, and the previous/next hour's guards may not guard again (no two hours in a row)
      const i = d.hours.indexOf(h);
      const blocked = new Set([...(d.hours[i - 1] ? d.hours[i - 1].guards : []), ...(S.kitchenMayGuard(t0, S.V) ? [] : [d.kitchen])]);
      const A = d.shifts.find(x => T(x.start) <= t0 && T(x.end) > t0).members;
      const eligible = present.filter(s => !A.includes(s.id) && !blocked.has(s.id));
      if (eligible.length >= hs.guards) return `avoidable: ${k} ${p} (eligible ${eligible.length})`;
      continue;
    }
    if (/משמרת|לוחמים$/.test(p)) { // generic size shortfall in a shift
      continue;
    }
    return `unexpected problem: ${k} ${p}`;
  }
  return null;
}

test("no absences: every rule holds on every day (post and patrol)", () => {
  const input = { soldiers, absences: [], days, dayTypes: mixedTypes, now: 0 };
  const { docs } = S.buildAll(input, {}, "rebuild");
  assert.equal(total(S.validate(input, docs)), 0, JSON.stringify(S.validate(input, docs)));
  for (const k of days) {
    const d = docs[k];
    assert.equal(d.v, 2);
    assert.ok(d.kitchen);
    if (d.type === "post") {
      same(d.shifts.map(sh => [sh.start.slice(11), sh.end.slice(11), sh.members.length]), [["07:00", "19:00", 8], ["19:00", "07:00", 8]]);
      assert.equal(d.hours.length, 24); assert.equal(d.hours[0].start.slice(11), "07:00");
      for (const h of d.hours) {
        const night = hourOf(T(h.start)) >= 23 || hourOf(T(h.start)) < 7;
        assert.equal(h.guards.length, night ? 2 : 1, `${k} ${h.start} guards`);
        assert.equal(h.carmelB.length, 0, "no inner post anymore");
      }
      for (const sh of d.shifts) { assert.ok(sh.members.some(id => role(id, "carmelALead"))); assert.ok(sh.members.some(id => role(id, "tigrisDriver"))); }
    } else {
      same(d.shifts.map(sh => [sh.start.slice(11), sh.end.slice(11), sh.members.length]), [["07:00", "19:00", 8], ["19:00", "07:00", 8]]);
      assert.equal(d.hours.length, 0);
      for (const sh of d.shifts) {
        assert.equal(sh.members.filter(id => role(id, "commander")).length, 2, "exactly 2 commanders");
        assert.ok(sh.members.some(id => role(id, "carmelALead")), "a lead in every patrol");
        assert.ok(sh.members.filter(id => role(id, "davidDriver")).length >= 2, "at least 2 David drivers");
        assert.ok(!sh.members.includes(d.kitchen));
      }
    }
  }
});

test("kitchen duty: never outer post / patrol; may guard only 20:00-08:00; nobody double-booked", () => {
  for (const seed of [1, 2, 3]) {
    const input = { soldiers, absences: randomAbsences(seed), days, dayTypes: mixedTypes, now: 0 };
    const { docs } = S.buildAll(input, {}, "rebuild");
    for (const k of days) {
      const d = docs[k];
      for (const sh of d.shifts) assert.ok(!sh.members.includes(d.kitchen), `${k} kitchen in ${sh.kind}`);
      for (const h of d.hours) {
        const t = T(h.start), hh = hourOf(t);
        if (h.guards.includes(d.kitchen)) assert.ok(hh >= 20 || hh < 8, `${k} ${h.start} kitchen guarding outside 20-08`);
        const A = d.shifts.find(x => T(x.start) <= t && T(x.end) > t).members;
        assert.ok(h.guards.every(g => !A.includes(g)));
      }
    }
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

test("fairness: total load is spread evenly across the team", () => {
  const input = { soldiers, absences: [], days, dayTypes: mixedTypes, now: 0 };
  const { stats } = S.buildAll(input, {}, "rebuild");
  const loads = soldiers.map(s => stats[s.id].load);
  const avg = loads.reduce((a, b) => a + b, 0) / loads.length;
  assert.ok(Math.max(...loads) - Math.min(...loads) <= avg * 0.2, `spread ${Math.min(...loads)}..${Math.max(...loads)} avg ${avg}`);
  const guards = soldiers.map(s => stats[s.id].guard);
  assert.ok(Math.max(...guards) - Math.min(...guards) <= 12, `guard spread ${guards}`);
});

test("repair of a valid roster changes nothing (stable, no write loops)", () => {
  const input = { soldiers, absences: randomAbsences(5), days, dayTypes: mixedTypes, now: 0 };
  const { docs } = S.buildAll(input, {}, "rebuild");
  const again = S.buildAll(input, JSON.parse(JSON.stringify(docs)), "repair").docs;
  assert.equal(JSON.stringify(again), JSON.stringify(docs));
});

test("new absence: soldier is replaced only where needed, past slots untouched, locks kept", () => {
  const input = { soldiers, absences: [], days, dayTypes: allPost, now: T("2026-11-16T12:00") };
  const { docs } = S.buildAll(input, {}, "rebuild");
  const k = "2026-11-17";
  const victim = docs[k].shifts[0].members.find(id => !soldiers.find(s => s.id === id).roles.length);
  const lockedId = docs[k].shifts[0].members.find(id => id !== victim);
  docs[k].shifts[0].locked = [lockedId];
  const pastBefore = JSON.stringify(docs["2026-11-15"]);
  const input2 = { ...input, absences: [{ soldierId: victim, start: `${k}T07:00`, end: `${S.plusDays(k, 1)}T07:00` }] };
  const after = S.buildAll(input2, JSON.parse(JSON.stringify(docs)), "repair").docs;
  assert.ok(!after[k].shifts[0].members.includes(victim), "victim removed");
  assert.equal(after[k].shifts[0].members.length, 8, "slot refilled");
  assert.ok(after[k].shifts[0].members.includes(lockedId), "locked member kept");
  assert.equal(JSON.stringify(after["2026-11-15"]), pastBefore, "past day unchanged");
  const changed = days.filter(d => JSON.stringify(after[d]) !== JSON.stringify(docs[d]));
  assert.ok(changed.length <= 3, `changed days: ${changed}`);
  assert.equal(total(S.validate(input2, after)), 0, JSON.stringify(S.validate(input2, after)));
});

test("both leads absent -> clear warning (outer post and patrol)", () => {
  const k = "2026-11-18";
  const absences = ["אברג׳יל", "אביאל"].map(n => ({ soldierId: idOf(n), start: `${k}T00:00`, end: `${S.plusDays(k, 1)}T12:00` }));
  for (const type of ["post", "patrol"]) {
    const input = { soldiers, absences, days, dayTypes: { [k]: type }, now: 0 };
    const { docs } = S.buildAll(input, {}, "rebuild");
    const p = S.validate(input, docs)[k];
    assert.ok(p.some(x => x.includes("חסר אברג׳יל/אביאל")), JSON.stringify(p));
  }
});

test("day type 'none' has no missions; first build mid-rotation skips finished days; assignmentsOf works", () => {
  const k = days[0];
  const input = { soldiers, absences: [], days, dayTypes: { [k]: "none" }, now: 0 };
  const { docs } = S.buildAll(input, {}, "rebuild");
  assert.equal(docs[k].shifts.length, 0); assert.equal(docs[k].kitchen, null);
  const mine = S.assignmentsOf(docs, idOf("תום"));
  assert.ok(mine.length > 0 && mine.every(a => a.start < a.end));
  const mid = S.buildAll({ ...input, now: T("2026-11-19T13:30") }, {}, "rebuild").docs;
  assert.ok(!mid["2026-11-17"] && mid["2026-11-19"] && mid["2026-11-20"]);
});

test("migration: an old-format (06:30) day that already started is kept; future old days are rebuilt under the new rules", () => {
  const old = (key, guard) => ({ type: "post", kitchen: "s13", kitchenLocked: false,
    shifts: [{ kind: "carmelA", start: `${key}T06:30`, end: `${key}T18:30`, members: ["s01", "s02", "s03", "s04", "s05", "s06", "s07", "s08"], locked: [] },
             { kind: "carmelA", start: `${key}T18:30`, end: `${S.plusDays(key, 1)}T06:30`, members: ["s18", "s09", "s10", "s11", "s12", "s14", "s15", "s16"], locked: ["s09"] }],
    hours: [{ start: `${key}T06:30`, guard, guardLocked: false, carmelB: ["s17", "s13", "s10", "s11"], bLocked: [] }] });
  const input = { soldiers, absences: [], days, dayTypes: allPost, now: T("2026-11-20T10:00") };
  const existing = { "2026-11-20": old("2026-11-20", "s16"), "2026-11-22": old("2026-11-22", "s16") };
  const { docs } = S.buildAll(input, existing, "repair");
  assert.equal(JSON.stringify(docs["2026-11-20"]), JSON.stringify(existing["2026-11-20"]), "started old day kept as-is");
  assert.equal(docs["2026-11-22"].v, 2); assert.equal(docs["2026-11-22"].shifts[0].start.slice(11), "07:00");
  const n = S.normalize(existing["2026-11-20"]);
  same(n.hours[0].guards, ["s16"]); assert.equal(n.v, 1);
  assert.ok(S.assignmentsOf({ "2026-11-20": existing["2026-11-20"] }, "s16").some(a => a.what === "עמדה אחורית"));
});

/* ---------- manual editing that ripples through the roster ---------- */
function setup(nowStr, types) {
  const input = { soldiers, absences: [], days, dayTypes: types || allPost, now: T(nowStr) };
  return { input, docs: S.buildAll(input, {}, "rebuild").docs };
}
const heldBy = (key, d, id) => S.slotsOf(key, d).filter(sl => S.holders(d, sl.ref).includes(id));

test("replace X by a busy Y for the whole day: Y takes X's slots, Y's old slots are refilled, rest rebalanced", () => {
  const { input, docs } = setup("2026-11-20T09:00");
  const k = "2026-11-21", d = docs[k];
  const X = d.shifts[0].members.find(id => !soldiers.find(s => s.id === id).roles.length);
  const Y = d.shifts[1].members.find(id => !soldiers.find(s => s.id === id).roles.length);
  const xSlots = heldBy(k, d, X).map(s => s.ref);
  const edited = S.replaceInDay(k, d, X, Y, input.now);
  const after = S.buildAll(input, { ...docs, [k]: edited }, "repair", { rebuildAfter: k }).docs;
  const nd = after[k];
  for (const ref of xSlots) assert.ok(S.holders(nd, ref).includes(Y), `Y in ${ref}`);
  assert.ok(!nd.shifts[1].members.includes(Y), "Y left his conflicting shift");
  assert.equal(nd.shifts[1].members.length, 8, "Y's old shift refilled");
  assert.ok(nd.shifts[0].locked.includes(Y), "Y locked");
  assert.equal(total(S.validate(input, after)), 0, JSON.stringify(S.validate(input, after)));
  for (const key of days.filter(x => x < k)) assert.equal(JSON.stringify(after[key]), JSON.stringify(docs[key]), `day before unchanged: ${key}`);
  assert.equal(JSON.stringify(S.buildAll(input, after, "repair").docs), JSON.stringify(after));
});

test("replacing the Tigris driver with a non-driver keeps a Tigris driver in the shift", () => {
  const { input, docs } = setup("2026-11-20T09:00");
  const k = "2026-11-22", d = docs[k];
  const i = d.shifts.findIndex(sh => sh.members.some(id => role(id, "tigrisDriver")));
  const X = d.shifts[i].members.find(id => role(id, "tigrisDriver"));
  const Y = soldiers.find(s => !s.roles.length && !d.shifts[i].members.includes(s.id)).id;
  const after = S.buildAll(input, { ...docs, [k]: S.replaceInDay(k, d, X, Y, input.now) }, "repair", { rebuildAfter: k }).docs;
  const sh = after[k].shifts[i];
  assert.ok(sh.members.includes(Y));
  assert.ok(sh.members.some(id => role(id, "tigrisDriver")), "a Tigris driver is still there");
  assert.equal(sh.members.length, 8);
  assert.equal(total(S.validate(input, after)), 0);
});

test("assign a free (no-mission) fighter to the rear position: locked, previous guard freed, no two hours in a row", () => {
  const { input, docs } = setup("2026-11-20T09:00");
  const k = "2026-11-21", d = docs[k], hi = 4;
  const X = S.freeAt(input, k, d, hi).find(id => !d.hours[hi - 1].guards.includes(id) && !d.hours[hi + 1].guards.includes(id));
  const oldGuard = d.hours[hi].guards[0];
  const edited = S.assignInDay(k, d, `g|${hi}`, X, oldGuard, input.now);
  const after = S.buildAll(input, { ...docs, [k]: edited }, "repair", { rebuildAfter: k }).docs;
  const nh = after[k].hours[hi];
  same(nh.guards, [X]); assert.ok(nh.gLocked.includes(X));
  assert.ok(S.freeAt(input, k, after[k], hi).includes(oldGuard), "previous guard is free now");
  assert.equal(total(S.validate(input, after)), 0, JSON.stringify(S.validate(input, after)[k]));
});

test("kitchen duty moved to a night guard hour stays kitchen; to a day guard hour it loses kitchen", () => {
  const { input, docs } = setup("2026-11-20T09:00");
  const k = "2026-11-21", d = docs[k], K = d.kitchen;
  const nightI = d.hours.findIndex(h => h.start.endsWith("21:00")), dayI = d.hours.findIndex(h => h.start.endsWith("12:00"));
  const night = S.buildAll(input, { ...docs, [k]: S.assignInDay(k, d, `g|${nightI}`, K, null, input.now) }, "repair", { rebuildAfter: k }).docs;
  assert.equal(night[k].kitchen, K); assert.ok(night[k].hours[nightI].guards.includes(K));
  const day = S.buildAll(input, { ...docs, [k]: S.assignInDay(k, d, `g|${dayI}`, K, null, input.now) }, "repair", { rebuildAfter: k }).docs;
  assert.notEqual(day[k].kitchen, K); assert.ok(day[k].hours[dayI].guards.includes(K));
  assert.equal(total(S.validate(input, night)) + total(S.validate(input, day)), 0);
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

test("patrol edit: adding a third commander is trimmed back to exactly 2", () => {
  const { input, docs } = setup("2026-11-20T09:00", Object.fromEntries(days.map(k => [k, "patrol"])));
  const k = "2026-11-21", d = docs[k];
  const extra = soldiers.find(s => s.roles.includes("commander") && !s.roles.includes("carmelALead") && !d.shifts[0].members.includes(s.id) && s.id !== d.kitchen).id;
  const X = d.shifts[0].members.find(id => !soldiers.find(s => s.id === id).roles.length);
  const after = S.buildAll(input, { ...docs, [k]: S.replaceInDay(k, d, X, extra, input.now) }, "repair", { rebuildAfter: k }).docs;
  const sh = after[k].shifts[0];
  assert.ok(sh.members.includes(extra), "locked commander kept");
  assert.equal(sh.members.filter(id => role(id, "commander")).length, 2, "exactly 2 commanders");
  assert.equal(sh.members.length, 8);
  assert.equal(total(S.validate(input, after)), 0, JSON.stringify(S.validate(input, after)[k]));
});

test("60 random edits (replace / move) keep the roster free of double bookings and stable", () => {
  let x = 11; const rnd = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = a => a[Math.floor(rnd() * a.length)];
  const input = { soldiers, absences: [], days, dayTypes: mixedTypes, now: T("2026-11-20T09:00") };
  let docs = S.buildAll(input, {}, "rebuild").docs;
  const future = days.filter(k => S.dayWindow(k, S.V)[1] > input.now);
  for (let n = 0; n < 60; n++) {
    const k = pick(future), d = docs[k];
    const slots = S.slotsOf(k, d).filter(sl => sl.t1 > input.now && S.holders(d, sl.ref).length);
    const sl = pick(slots); const X = pick(S.holders(d, sl.ref));
    let edited;
    if (rnd() < 0.5) edited = S.replaceInDay(k, d, X, pick(soldiers.filter(s => s.id !== X)).id, input.now);
    else edited = S.moveInDay(k, d, sl.ref, pick(S.slotsOf(k, d).filter(t => t.t1 > input.now && t.ref !== sl.ref)).ref, X, input.now);
    docs = S.buildAll(input, { ...docs, [k]: edited }, "repair", { rebuildAfter: k }).docs;
    const problems = Object.values(S.validate(input, docs)).flat();
    // locks can legitimately make a rule impossible; never a double booking
    assert.ok(!problems.some(p => /בו־זמנית|משובץ פעמיים|לוחם כפול|גם ב|תורן המטבח (שומר|משובץ)|השומר/.test(p)), `edit ${n} (${k}): ${problems.join(" | ")}`);
  }
  assert.equal(JSON.stringify(S.buildAll(input, docs, "repair").docs), JSON.stringify(docs), "stable after edits");
});

test("start from the commander's list (today from 15:00): openers locked, then the system continues", () => {
  const k = "2026-11-19";
  const guards = { "15:00": "מתניה", "16:00": "עירן", "17:00": "אביאל", "18:00": "מארק", "19:00": "תום", "20:00": "מתניה", "21:00": "שאער" };
  const outer = ["אברג׳יל", "יואב", "ממן", "עירוני", "צבי", "רוזמן", "מאור", "סשה"].map(idOf);
  const seed = { v: 2, type: "post", startAt: `${k}T15:00`, kitchen: idOf("הררי"), kitchenLocked: true,
    shifts: [{ kind: "carmelA", start: `${k}T15:00`, end: `${k}T19:00`, members: outer, locked: outer },
             { kind: "carmelA", start: `${k}T19:00`, end: `2026-11-20T07:00`, members: [], locked: [] }],
    hours: Array.from({ length: 16 }, (_, i) => { const st = S.fmt(T(`${k}T15:00`) + i * H), g = guards[st.slice(11)]; return { start: st, guards: g ? [idOf(g)] : [], gLocked: g ? [idOf(g)] : [], carmelB: [], bLocked: [] }; }) };
  const absences = ["גילמור", "גייבל"].map(n => ({ soldierId: idOf(n), start: `${k}T00:00`, end: `2026-11-20T00:00` }));
  const input = { soldiers, absences, days, dayTypes: allPost, now: T(`${k}T15:53`) };
  const { docs } = S.buildAll(input, { [k]: seed }, "repair", { rebuildAfter: k });
  const d = docs[k];
  assert.equal(d.kitchen, idOf("הררי"));
  same(d.shifts[0].members, outer);
  for (const [hh, n] of Object.entries(guards)) same(d.hours.find(h => h.start.endsWith(hh)).guards, [idOf(n)], hh);
  for (const h of d.hours.filter(h => h.start >= `${k}T23:00`)) assert.equal(h.guards.length, 2, h.start);
  // the photo's "no mission" at 16:00: Harari is kitchen (a mission), Gilmor/Geibel absent
  const free16 = S.freeAt(input, k, d, 1).map(id => soldiers.find(s => s.id === id).name);
  for (const n of ["גילמור", "גייבל", "הררי", "עירן"]) assert.ok(!free16.includes(n), n);
  assert.equal(total(S.validate(input, docs)), 0, JSON.stringify(S.validate(input, docs)));
});

test("rear position: never two hours in a row, spaced out, and not straight after kitchen duty", () => {
  const input = { soldiers, absences: [], days, dayTypes: allPost, now: 0 };
  const { docs } = S.buildAll(input, {}, "rebuild");
  const gaps = [];
  const last = {};
  for (const k of days) for (const [i, h] of docs[k].hours.entries()) {
    const t = T(h.start);
    for (const g of h.guards) {
      if (i) assert.ok(!docs[k].hours[i - 1].guards.includes(g), `${k} ${h.start} two in a row`);
      if (last[g] !== undefined) gaps.push((t - last[g]) / H);
      last[g] = t;
    }
  }
  const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const sorted = [...gaps].sort((a, b) => a - b), median = sorted[Math.floor(sorted.length / 2)];
  assert.ok(avg >= 4 && median >= 4, `avg gap ${avg.toFixed(1)}h median ${median}h`);
  // kitchen of day k must not guard / go to the outer post in the first 2 hours after 07:00 next day
  for (const k of days.slice(0, -1)) {
    const kid = docs[k].kitchen, next = docs[S.plusDays(k, 1)];
    if (!next || !next.hours.length) continue;
    assert.ok(!next.hours.slice(0, 2).some(h => h.guards.includes(kid)), `${k} kitchen guards right after`);
    assert.ok(!next.shifts[0].members.includes(kid), `${k} kitchen straight into the outer post`);
  }
});

