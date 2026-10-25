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
      fetch(url) {
        fetchCount += 1;
        if (options.fetchError) throw new Error(options.fetchError);
        if (url.includes("TYPE=rosters")) return {
          getResponseCode: () => 200,
          getContentText: () => JSON.stringify({rosters: {franchise: {week: String(options.week || 7)}}}),
        };
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
  assert.equal(context.fetchCount(), 2);
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
  assert.equal(context.fetchCount(), 2);
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

test("all NFL kickoff shapes open the same exact 90-minute monitor window", () => {
  const kickoffs = [
    "2026-11-25T21:30:00Z", // Wednesday
    "2026-11-26T17:30:00Z", // Thanksgiving early
    "2026-11-28T21:30:00Z", // Saturday
    "2026-11-29T14:30:00Z", // Sunday international
    "2026-11-29T18:00:00Z", // Sunday 1 p.m. ET
    "2026-11-29T21:05:00Z", // Sunday 4:05 p.m. ET
    "2026-11-29T21:25:00Z", // Sunday 4:25 p.m. ET
    "2026-11-30T01:20:00Z", // Sunday night
    "2026-12-01T01:15:00Z", // Monday night
  ];
  for (const kickoffText of kickoffs) {
    const kickoffMs = Date.parse(kickoffText);
    const context = schedulerContext([kickoffMs / 1000]);
    assert.equal(context.lineupGuardianDue_(new Date(kickoffMs - 90 * 60000), context.testProperties).monitor, true, kickoffText);
    assert.equal(context.lineupGuardianDue_(new Date(kickoffMs - 90 * 60000 - 1), context.testProperties).monitor, false, kickoffText);
    assert.equal(context.lineupGuardianDue_(new Date(kickoffMs + 1), context.testProperties).monitor, false, kickoffText);
  }
});

test("multiple kickoff groups each receive their own monitor window", () => {
  const early = Date.parse("2026-11-01T18:00:00Z");
  const late = Date.parse("2026-11-01T21:25:00Z");
  const context = schedulerContext([early / 1000, late / 1000]);
  assert.equal(context.lineupGuardianDue_(new Date(early - 30 * 60000), context.testProperties).monitor, true);
  const secondContext = schedulerContext([early / 1000, late / 1000]);
  assert.equal(secondContext.lineupGuardianDue_(new Date(late - 30 * 60000), secondContext.testProperties).monitor, true);
});

test("Week 8 actual kickoff groups and first-game safety net survive the November DST change", () => {
  const kickoffs = [
    "2026-10-30T00:15:00Z",
    "2026-11-01T18:00:00Z",
    "2026-11-01T21:05:00Z",
    "2026-11-01T21:25:00Z",
    "2026-11-02T01:20:00Z",
    "2026-11-03T01:15:00Z",
  ].map(Date.parse);
  for (const kickoff of kickoffs) {
    const context = schedulerContext(kickoffs.map((time) => time / 1000), { week: 8 });
    assert.equal(context.lineupGuardianDue_(new Date(kickoff - 90 * 60000), context.testProperties).monitor, true);
    assert.equal(context.lineupGuardianDue_(new Date(kickoff - 10 * 60000), context.testProperties).monitor, true);
  }
  const context = schedulerContext(kickoffs.map((time) => time / 1000), { week: 8 });
  assert.equal(context.lineupGuardianDue_(new Date("2026-10-29T10:05:00Z"), context.testProperties).initial, true);
  assert.equal(context.lineupGuardianDue_(new Date("2026-10-29T11:05:00Z"), context.testProperties).initial, false);
});
