import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

function formatEastern(date, timeZone, pattern) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  if (pattern === "yyyy-MM-dd") return `${parts.year}-${parts.month}-${parts.day}`;
  if (pattern === "HH:mm") return `${parts.hour}:${parts.minute}`;
  throw new Error(`Unexpected test date pattern: ${pattern}`);
}

function schedulerContext(kickoffs) {
  const source = fs.readFileSync("scheduler/Code.gs", "utf8");
  const context = {
    UrlFetchApp: {
      fetch() {
        return {
          getResponseCode: () => 200,
          getContentText: () => JSON.stringify({
            nflSchedule: { matchup: kickoffs.map((kickoff) => ({ kickoff: String(kickoff) })) },
          }),
        };
      },
    },
    Utilities: { formatDate: formatEastern },
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context;
}

test("precision scheduler is active only inside a real 90-minute kickoff window", () => {
  const kickoff = Date.parse("2026-10-23T00:15:00Z") / 1000;
  const context = schedulerContext([kickoff]);
  assert.equal(context.lineupGuardianDue_(new Date("2026-10-22T22:45:00Z")).monitor, true);
  assert.equal(context.lineupGuardianDue_(new Date("2026-10-22T22:44:59Z")).monitor, false);
  assert.equal(context.lineupGuardianDue_(new Date("2026-10-23T00:15:01Z")).monitor, false);
});

test("initial-lineup dispatch is limited to 6 a.m. ET on first game day", () => {
  const kickoff = Date.parse("2026-10-23T00:15:00Z") / 1000;
  const context = schedulerContext([kickoff]);
  assert.equal(context.lineupGuardianDue_(new Date("2026-10-22T10:05:00Z")).initial, true);
  assert.equal(context.lineupGuardianDue_(new Date("2026-10-22T10:59:00Z")).initial, true);
  assert.equal(context.lineupGuardianDue_(new Date("2026-10-22T11:00:00Z")).initial, false);
  assert.equal(context.lineupGuardianDue_(new Date("2026-10-21T10:05:00Z")).initial, false);
});
