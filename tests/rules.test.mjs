// Firestore security rules tests. Run with: npm run test:rules (starts the Firestore emulator).
import { test, before, after, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment, assertSucceeds, assertFails,
} from "@firebase/rules-unit-testing";
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where, documentId,
  serverTimestamp, Timestamp,
} from "firebase/firestore";

let env;
const ALICE = "alice_uid", BOB = "bob_uid";

// Exactly the shape the app writes (see snapshot() in docs/app.js).
function team(overrides = {}) {
  return {
    app: "matsevet", version: 1,
    team: { name: "צוות 3", createdAt: 1793699692432 },
    soldiers: [{ id: "s1", name: "דני", active: true, order: 1 }],
    absences: [{ id: "a1", soldierId: "s1", type: "home", reason: "יציאה", note: "", allDay: true, start: "2026-11-16T00:00", end: "2026-11-17T00:00", updatedAt: "2026-11-10T10:00:00.000Z" }],
    settings: { reserveDays: ["2026-11-16", "2026-11-17"], minStrength: 15, reportTimes: ["10:00", "20:00"] },
    lastBackup: null,
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}
const db = uid => env.authenticatedContext(uid).firestore();
const anon = () => env.unauthenticatedContext().firestore();

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-matsevet",
    firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8") },
  });
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  // Seed Bob's document with rules disabled.
  await env.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(), "teams", BOB), { ...team(), team: { name: "הצוות של בוב", createdAt: 1 }, updatedAt: Timestamp.now() });
  });
});

// ---- owner can use their own document ----
test("owner can create, read, update and delete own team", async () => {
  const ref = doc(db(ALICE), "teams", ALICE);
  await assertSucceeds(setDoc(ref, team()));
  await assertSucceeds(getDoc(ref));
  await assertSucceeds(setDoc(ref, team({ lastBackup: 1793700000000 })));
  await assertSucceeds(updateDoc(ref, { "settings.minStrength": 14, updatedAt: serverTimestamp() }));
  await assertSucceeds(deleteDoc(ref));
});
test("documents written by the current app version are accepted (no reportTimes, no app/version)", async () => {
  const t = team(); delete t.settings.reportTimes; delete t.app; delete t.version;
  await assertSucceeds(setDoc(doc(db(ALICE), "teams", ALICE), t));
});

// ---- isolation between users ----
test("cannot read another user's team", async () => {
  await assertFails(getDoc(doc(db(ALICE), "teams", BOB)));
});
test("cannot overwrite another user's team", async () => {
  await assertFails(setDoc(doc(db(ALICE), "teams", BOB), team()));
});
test("cannot update another user's team", async () => {
  await assertFails(updateDoc(doc(db(ALICE), "teams", BOB), { "team.name": "hacked", updatedAt: serverTimestamp() }));
});
test("cannot delete another user's team", async () => {
  await assertFails(deleteDoc(doc(db(ALICE), "teams", BOB)));
});
test("cannot create a team under someone else's uid", async () => {
  await assertFails(setDoc(doc(db(ALICE), "teams", "carol_uid"), team()));
});

// ---- no enumeration ----
test("cannot list the teams collection", async () => {
  await assertFails(getDocs(collection(db(ALICE), "teams")));
});
test("cannot query teams, even filtered to own uid", async () => {
  await assertFails(getDocs(query(collection(db(ALICE), "teams"), where(documentId(), "==", ALICE))));
  await assertFails(getDocs(query(collection(db(ALICE), "teams"), where("team.name", "==", "הצוות של בוב"))));
});

// ---- unauthenticated ----
test("signed-out users can do nothing", async () => {
  await assertFails(getDoc(doc(anon(), "teams", BOB)));
  await assertFails(setDoc(doc(anon(), "teams", BOB), team()));
  await assertFails(deleteDoc(doc(anon(), "teams", BOB)));
  await assertFails(getDocs(collection(anon(), "teams")));
});

// ---- default deny elsewhere ----
test("other collections and subcollections are denied", async () => {
  await assertFails(setDoc(doc(db(ALICE), "users", ALICE), { a: 1 }));
  await assertFails(getDoc(doc(db(ALICE), "users", ALICE)));
  await assertFails(setDoc(doc(db(ALICE), "teams", ALICE, "private", "x"), { a: 1 }));
  await assertFails(getDoc(doc(db(ALICE), "teams", BOB, "private", "x")));
});

// ---- shape / size validation ----
test("rejects unknown top-level fields", async () => {
  await assertFails(setDoc(doc(db(ALICE), "teams", ALICE), team({ isAdmin: true })));
});
test("rejects missing required fields", async () => {
  const t = team(); delete t.soldiers;
  await assertFails(setDoc(doc(db(ALICE), "teams", ALICE), t));
});
test("rejects wrong types", async () => {
  await assertFails(setDoc(doc(db(ALICE), "teams", ALICE), team({ soldiers: "x" })));
  await assertFails(setDoc(doc(db(ALICE), "teams", ALICE), team({ team: { name: 5 } })));
  await assertFails(setDoc(doc(db(ALICE), "teams", ALICE), team({ settings: { reserveDays: [], minStrength: "15" } })));
  await assertFails(setDoc(doc(db(ALICE), "teams", ALICE), team({ lastBackup: "yesterday" })));
});
test("rejects oversized data", async () => {
  await assertFails(setDoc(doc(db(ALICE), "teams", ALICE), team({ team: { name: "x".repeat(81) } })));
  await assertFails(setDoc(doc(db(ALICE), "teams", ALICE), team({ soldiers: Array.from({ length: 301 }, (_, i) => ({ id: "s" + i, name: "n" })) })));
  await assertFails(setDoc(doc(db(ALICE), "teams", ALICE), team({ settings: { reserveDays: Array.from({ length: 401 }, () => "2026-11-16") } })));
});
test("rejects client-chosen timestamps (updatedAt must be server time)", async () => {
  await assertFails(setDoc(doc(db(ALICE), "teams", ALICE), team({ updatedAt: Timestamp.fromMillis(0) })));
  await assertFails(setDoc(doc(db(ALICE), "teams", ALICE), team({ updatedAt: "now" })));
});
