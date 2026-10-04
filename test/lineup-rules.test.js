import test from "node:test";
import assert from "node:assert/strict";
import { optimizeLineup, validateLineup } from "../src/lineup-rules.js";

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
