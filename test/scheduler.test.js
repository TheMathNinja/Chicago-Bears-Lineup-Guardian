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

function schedulerContext(kickoffs, options = {}) {
  const source = fs.readFileSync("scheduler/Code.gs", "utf8");
  const properties = new Map(Object.entries(options.properties || {}));
  let fetchCount = 0;
  const context = {
    UrlFetchApp: {
      fetchAll(requests) {
        fetchCount += 1;
        if (options.fetchError) throw new Error(options.fetchError);
        const response = {
          getResponseCode: () => 200,
          getContentText: () => JSON.stringify({
            nflSchedule: { matchup: kickoffs.map((kickoff) => ({ kickoff: String(kickoff) })) },
          }),
        };
        return requests.map((_, index) => index === 0 ? response : {
          getResponseCode: () => 200,
          getContentText: () => JSON.stringify({nflSchedule: {matchup: []}}),
        });
      },
    },
    Utilities: { formatDate: formatEastern },
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  context.testProperties = {
    getProperty: (key) => properties.get(key) || null,
    setProperty: (key, value) => properties.set(key, String(value)),
    setProperties: (values) => Object.entries(values).forEach(([key, value]) => properties.set(key, String(value))),
  };
  context.fetchCount = () => fetchCount;
  return context;
}

test("precision scheduler is active only inside a real 90-minute kickoff window", () => {
  const kickoff = Date.parse("2026-10-23T00:15:00Z") / 1000;
  const context = schedulerContext([kickoff]);
  assert.equal(context.lineupGuardianDue_(new Date("2026-10-22T22:45:00Z"), context.testProperties).monitor, true);
  assert.equal(context.lineupGuardianDue_(new Date("2026-10-22T22:44:59Z"), context.testProperties).monitor, false);
  assert.equal(context.lineupGuardianDue_(new Date("2026-10-23T00:15:01Z"), context.testProperties).monitor, false);
  assert.equal(context.fetchCount(), 1);
});

test("initial-lineup dispatch is limited to 6 a.m. ET on first game day", () => {
  const kickoff = Date.parse("2026-10-23T00:15:00Z") / 1000;
  const context = schedulerContext([kickoff]);
  assert.equal(context.lineupGuardianDue_(new Date("2026-10-22T10:05:00Z"), context.testProperties).initial, true);
  assert.equal(context.lineupGuardianDue_(new Date("2026-10-22T10:59:00Z"), context.testProperties).initial, true);
  assert.equal(context.lineupGuardianDue_(new Date("2026-10-22T11:00:00Z"), context.testProperties).initial, false);
  assert.equal(context.lineupGuardianDue_(new Date("2026-10-21T10:05:00Z"), context.testProperties).initial, false);
});

test("kickoff schedule is cached instead of fetched every five minutes", () => {
  const kickoff = Date.parse("2026-10-23T00:15:00Z") / 1000;
  const context = schedulerContext([kickoff]);
  const first = new Date("2026-10-22T20:00:00Z");
  context.lineupGuardianDue_(first, context.testProperties);
  context.lineupGuardianDue_(new Date(first.getTime() + 5 * 60000), context.testProperties);
  assert.equal(context.fetchCount(), 1);
});

test("stale kickoff cache keeps scheduler safe during an MFL outage", () => {
  const kickoff = Date.parse("2026-10-23T00:15:00Z");
  const context = schedulerContext([], {
    fetchError: "temporary server error",
    properties: {
      LINEUP_GUARDIAN_KICKOFFS: JSON.stringify([kickoff]),
      LINEUP_GUARDIAN_KICKOFFS_FETCHED_AT: "1",
    },
  });
  const due = context.lineupGuardianDue_(new Date("2026-10-22T22:45:00Z"), context.testProperties);
  assert.equal(due.monitor, true);
  assert.equal(context.fetchCount(), 1);
});

test("explicit weekly schedules preserve the current Sunday after MFL default-week rollover", () => {
  const sundayKickoff = Date.parse("2026-10-25T20:25:00Z") / 1000;
  const context = schedulerContext([sundayKickoff]);
  const due = context.lineupGuardianDue_(new Date("2026-10-25T19:00:00Z"), context.testProperties);
  assert.equal(due.monitor, true);
});
