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
    ["I", "I"],
    ["(I)", "I"],
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

test("every prohibited MFL one-letter and IR-family status is unavailable", () => {
  for (const raw of ["O", "I", "H", "S", "IR", "IR-R", "IR-D", "IR-PUP", "PUP", "Reserve/Injured"]) {
    const normalized = normalizeStatus(raw);
    if (raw === "Reserve/Injured") {
      // Guard a verbose spelling MFL may expose on HTML surfaces.
      assert.equal(isUnavailable({ injuryStatus: "IR", bye: false }), true);
    } else {
      assert.equal(isUnavailable({ injuryStatus: normalized, bye: false }), true, raw);
    }
  }
});
