import test from "node:test";
import assert from "node:assert/strict";
import { isUnavailable, normalizeStatus } from "../src/normalize.js";

test("normalizes verbose MFL unavailable statuses", () => {
  const cases = [
    ["Out", "O"],
    ["(O)", "O"],
    ["Suspended", "S"],
    ["Holdout", "H"],
    ["IR-PUP", "IR"],
    ["Injured Reserve", "IR"],
  ];
  for (const [raw, expected] of cases) {
    const normalized = normalizeStatus(raw);
    assert.equal(normalized, expected);
    assert.equal(isUnavailable({ injuryStatus: normalized, bye: false }), true);
  }
});

test("does not mark ordinary active/questionable statuses unavailable", () => {
  for (const raw of ["", "Questionable", "Doubtful"]) {
    assert.equal(isUnavailable({ injuryStatus: normalizeStatus(raw), bye: false }), false);
  }
  assert.equal(isUnavailable({ injuryStatus: "", bye: true }), true);
});
