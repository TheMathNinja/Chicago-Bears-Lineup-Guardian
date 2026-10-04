import test from "node:test";
import assert from "node:assert/strict";
import { isInitialLineupRunDue, lineupSubmissionStatus } from "../src/submission-status.js";

test("finds the Bears week-specific submission stamp", () => {
  const html = `<table class="report"><caption>Chicago Bears Week 4 lineup</caption><tr><td>Lineup submitted at Sun Oct 4 12:42:06 p.m. ET 2026 - Lineup Details</td></tr></table>`;
  assert.deepEqual(lineupSubmissionStatus(html, "Chicago Bears", 4), {
    status: "submitted", detail: "Sun Oct 4 12:42:06 p.m. ET 2026",
  });
});

test("does not treat an inherited lineup as submitted", () => {
  const html = `<table class="report"><caption>Chicago Bears Week 5 lineup</caption><tr><td>Previous week's lineup</td></tr></table>`;
  assert.equal(lineupSubmissionStatus(html, "Chicago Bears", 5).status, "not_submitted");
});

test("6 a.m. gate is DST-safe and limited to first game day", () => {
  assert.equal(isInitialLineupRunDue(new Date("2026-10-08T10:04:00Z"), new Date("2026-10-08T23:15:00Z")), true);
  assert.equal(isInitialLineupRunDue(new Date("2026-10-08T11:04:00Z"), new Date("2026-10-08T23:15:00Z")), false);
  assert.equal(isInitialLineupRunDue(new Date("2026-10-07T10:04:00Z"), new Date("2026-10-08T23:15:00Z")), false);
});
