import test from "node:test";
import assert from "node:assert/strict";
import { optimizeActiveLineup, optimizeLineup, validateLineup } from "../src/lineup-rules.js";

const rules = {
  total: 21, offense: 7, defense: 12,
  positions: {
    QB: { min: 1, max: 1 }, RB: { min: 1, max: 2 }, WR: { min: 2, max: 4 }, TE: { min: 1, max: 2 },
    PK: { min: 1, max: 1 }, PN: { min: 1, max: 1 }, DT: { min: 2, max: 3 }, DE: { min: 2, max: 3 },
    LB: { min: 1, max: 3 }, CB: { min: 2, max: 4 }, S: { min: 2, max: 3 },
  },
};

function players(position, scores) {
  return scores.map((projection, i) => ({ id: `${position}${i}`, position, projection, eligible: true }));
}

test("post-promotion and Active-only fallback preserve locked starters and exclude remaining Taxi", () => {
  const simpleRules = { total: 2, offense: 2, defense: 0, positions: { QB: { min: 1, max: 1 }, WR: { min: 1, max: 1 } } };
  const pool = [
    { id: "locked", position: "QB", projection: 5, rosterStatus: "ROSTER", starter: true, gameLocked: true, eligible: false },
    { id: "benchQB", position: "QB", projection: 50, rosterStatus: "ROSTER", eligible: true },
    { id: "promoted", position: "WR", projection: 10, rosterStatus: "ROSTER", eligible: true },
    { id: "taxi", position: "WR", projection: 100, rosterStatus: "TAXI_SQUAD", eligible: true },
  ];
  const result = optimizeActiveLineup({ players: pool, rules: simpleRules });
  assert.deepEqual(result.players.map((player) => player.id).sort(), ["locked", "promoted"]);
});

test("optimizer searches all eligible positions and returns a complete legal lineup", () => {
  const pool = [
    ...players("QB", [30]), ...players("RB", [20, 19, 1]), ...players("WR", [18, 17, 16, 15, 1]), ...players("TE", [14, 13, 1]),
    ...players("PK", [8]), ...players("PN", [7]), ...players("DT", [12, 11, 1]), ...players("DE", [12, 11, 10]),
    ...players("LB", [15, 14, 13]), ...players("CB", [15, 14, 13, 12]), ...players("S", [15, 14, 13]),
  ];
  const result = optimizeLineup({ players: pool, rules, currentStarterIds: pool.slice(0, 8).map((p) => p.id) });
  assert.equal(validateLineup(result.players, rules).valid, true);
  assert.equal(result.players.length, 21);
  assert.equal(result.players.filter((p) => ["QB", "RB", "WR", "TE"].includes(p.position)).length, 7);
  assert.equal(result.players.filter((p) => ["DT", "DE", "LB", "CB", "S"].includes(p.position)).length, 12);
});

test("locked starters are preserved", () => {
  const pool = [
    ...players("QB", [30]), ...players("RB", [20, 19]), ...players("WR", [18, 17, 16, 15]), ...players("TE", [14, 13]),
    ...players("PK", [8]), ...players("PN", [7]), ...players("DT", [12, 11, 1]), ...players("DE", [12, 11, 10]),
    ...players("LB", [15, 14, 13]), ...players("CB", [15, 14, 13, 12]), ...players("S", [15, 14, 13]),
  ];
  const result = optimizeLineup({ players: pool, rules, lockedStarterIds: ["WR3"] });
  assert.ok(result.players.some((p) => p.id === "WR3"));
});

test("already-started locked players remain legal while later replacements are optimized", () => {
  const pool = [
    ...players("QB", [30]), ...players("RB", [20, 19]), ...players("WR", [18, 17, 16, 15]), ...players("TE", [14, 13]),
    ...players("PK", [8]), ...players("PN", [7]), ...players("DT", [12, 11, 1]), ...players("DE", [12, 11, 10]),
    ...players("LB", [15, 14, 13]), ...players("CB", [15, 14, 13, 12]), ...players("S", [15, 14, 13]),
  ];
  const locked = pool.find((p) => p.id === "WR3");
  locked.eligible = false;
  const result = optimizeLineup({ players: pool, rules, lockedStarterIds: [locked.id] });
  assert.ok(result.players.some((p) => p.id === locked.id));
  assert.equal(validateLineup(result.players, rules).valid, true);
});

test("ineligible players are never selected", () => {
  const pool = [
    ...players("QB", [30]), ...players("RB", [20, 19]), ...players("WR", [99, 18, 17, 16, 15]), ...players("TE", [14, 13]),
    ...players("PK", [8]), ...players("PN", [7]), ...players("DT", [12, 11, 1]), ...players("DE", [12, 11, 10]),
    ...players("LB", [15, 14, 13]), ...players("CB", [15, 14, 13, 12]), ...players("S", [15, 14, 13]),
  ];
  pool.find((p) => p.id === "WR0").eligible = false;
  const result = optimizeLineup({ players: pool, rules });
  assert.ok(!result.players.some((p) => p.id === "WR0"));
});

test("missing projections remain last-resort legal replacements", () => {
  const pool = [
    ...players("QB", [30]), ...players("RB", [20, 19]), ...players("WR", [18, 17, 16, 15]), ...players("TE", [14, 13]),
    ...players("PK", [8]), ...players("PN", [7]), ...players("DT", [12, 11, 1]), ...players("DE", [12, 11, 10]),
    ...players("LB", [15, 14, 13]), ...players("CB", [15, 14, 13, 12]), ...players("S", [15, 14, 13]),
  ];
  const onlyQuarterback = pool.find((player) => player.position === "QB");
  onlyQuarterback.projection = Number.NEGATIVE_INFINITY;
  const result = optimizeLineup({ players: pool, rules });
  assert.equal(validateLineup(result.players, rules).valid, true);
  assert.ok(result.players.some((player) => player.id === onlyQuarterback.id));
});

test("multiple inactive starters can be replaced across different eligible positions", () => {
  const pool = [
    ...players("QB", [30]), ...players("RB", [20, 19]), ...players("WR", [18, 17, 16, 15]), ...players("TE", [14, 13]),
    ...players("PK", [8]), ...players("PN", [7]), ...players("DT", [12, 11, 1]), ...players("DE", [12, 11, 10]),
    ...players("LB", [15, 14, 13]), ...players("CB", [15, 14, 13, 12]), ...players("S", [15, 14, 13]),
  ];
  const initial = optimizeLineup({ players: pool, rules }).players;
  const inactive = [initial.find((player) => player.position === "WR"), initial.find((player) => player.position === "DE")];
  for (const player of inactive) player.eligible = false;
  const result = optimizeLineup({
    players: pool,
    rules,
    currentStarterIds: initial.map((player) => player.id),
  });
  assert.equal(validateLineup(result.players, rules).valid, true);
  for (const player of inactive) assert.ok(!result.players.some((candidate) => candidate.id === player.id));
});
