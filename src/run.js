import fs from "node:fs";
import { dryRun, loadLeagues, lookaheadMinutes, requireCredentials, season } from "./config.js";
import { writeDashboard } from "./dashboard.js";
import { optimizeActiveLineup, optimizeLineup, parseRules, validateLineup } from "./lineup-rules.js";
import { getByeTeams, getPlayerRows, mapKickoffs } from "./lineup-data.js";
import { exportJson, login, promoteTaxiPlayers, requestText, sendMflEmail, submitLineup, verifyLogin } from "./mfl.js";
import { isUnavailable, rows } from "./normalize.js";
import { isInitialLineupRunDue, lineupSubmissionStatus } from "./submission-status.js";

const now = new Date(process.env.NOW || Date.now());
const statePath = "data/state.json";
fs.mkdirSync("data", { recursive: true });
const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, "utf8")) : { events: [], leagues: [] };
const runMode = process.env.RUN_MODE || "monitor";

function projectionLabel(player) {
  return Number.isFinite(player.projection) ? player.projection.toFixed(1) : "projection unavailable";
}

function event(league, action, detail) {
  state.events.push({ time: now.toISOString(), league, action, detail });
  state.events = state.events.slice(-500);
}

function findFranchise(weeklyResults, franchiseId) {
  for (const matchup of rows(weeklyResults.weeklyResults?.matchup)) {
    for (const franchise of rows(matchup.franchise)) if (franchise.id === franchiseId) return franchise;
  }
  throw new Error(`Franchise ${franchiseId} is absent from weekly results`);
}

function isInWindow(kickoff) {
  const delta = kickoff - now;
  return delta >= 0 && delta <= lookaheadMinutes * 60_000;
}

async function readLeague(league, cookie) {
  const leagueData = await exportJson(season, "league", { L: league.leagueId }, cookie);
  const roster = await exportJson(season, "rosters", { L: league.leagueId, FRANCHISE: league.franchiseId }, cookie);
  const week = Number(roster.rosters.franchise.week);
  const [weeklyResults, players, injuries, projections, schedule, byes] = await Promise.all([
    exportJson(season, "weeklyResults", { L: league.leagueId, W: week }, cookie),
    exportJson(season, "players", {}, cookie),
    exportJson(season, "injuries", { W: week }, cookie),
    exportJson(season, "projectedScores", { L: league.leagueId, W: week }, cookie),
    exportJson(season, "nflSchedule", { W: week }, cookie),
    exportJson(season, "nflByeWeeks", { W: week }, cookie),
  ]);
  const franchise = findFranchise(weeklyResults, league.franchiseId);
  const kickoffs = mapKickoffs(schedule);
  if (!kickoffs.size) throw new Error(`MFL returned no NFL kickoff data for Week ${week}`);
  return { leagueData, roster, week, franchise, players, injuries, projections, schedule, byes, kickoffs };
}

async function readSubmissionStatus(league, week, cookie) {
  const url = `https://${league.webHost}/${season}/options?L=${league.leagueId}&O=06&W=${week}`;
  const html = await requestText(url, cookie);
  return lineupSubmissionStatus(html, "Chicago Bears", week);
}

function taxiIdsInProposal(proposal) {
  return proposal.players.filter((player) => player.rosterStatus === "TAXI_SQUAD").map((player) => player.id);
}

async function promoteTaxiSelections({ league, cookie, snapshot, proposal, rules, currentStarterIds = [] }) {
  const taxiIds = taxiIdsInProposal(proposal);
  if (!taxiIds.length) return { snapshot, proposal, promotedIds: [] };

  let promotionError;
  try {
    await promoteTaxiPlayers({
      season, webHost: league.webHost, leagueId: league.leagueId, playerIds: taxiIds, cookie,
    });
  } catch (error) {
    promotionError = error;
  }

  const refreshed = await readLeague(league, cookie);
  const refreshedStarterIds = String(refreshed.franchise.starters || "").split(",").filter(Boolean).sort();
  const originalStarterIds = String(snapshot.franchise.starters || "").split(",").filter(Boolean).sort();
  if (refreshed.week !== snapshot.week || refreshedStarterIds.join(",") !== originalStarterIds.join(",")) {
    throw new Error("Week or lineup changed during Taxi promotion; refusing stale lineup submission");
  }
  const rosterPlayers = rows(refreshed.roster.rosters?.franchise?.player);
  const statusById = new Map(rosterPlayers.map((player) => [player.id, player.status]));
  const notPromoted = taxiIds.filter((id) => statusById.get(id) !== "ROSTER");
  if (promotionError || notPromoted.length) {
    const reason = promotionError?.message || `MFL did not move player(s) ${notPromoted.join(", ")} to Active`;
    console.warn(`${league.key}: Taxi promotion unavailable; trying the best Active-only lineup. ${reason}`);
    const activePool = getPlayerRows({
      ...refreshed, starters: refreshed.franchise, byeTeams: getByeTeams(refreshed.byes), now,
    }).map((player) => ({ ...player, eligible: player.eligible && player.rosterStatus === "ROSTER" }));
    const activeProposal = optimizeActiveLineup({ players: activePool, rules, currentStarterIds });
    return { snapshot: refreshed, proposal: activeProposal, promotedIds: taxiIds.filter((id) => statusById.get(id) === "ROSTER") };
  }

  const refreshedPool = getPlayerRows({
    ...refreshed, starters: refreshed.franchise, byeTeams: getByeTeams(refreshed.byes), now,
  });
  const refreshedProposal = optimizeActiveLineup({ players: refreshedPool, rules, currentStarterIds });
  const stillTaxi = taxiIdsInProposal(refreshedProposal);
  if (stillTaxi.length) {
    throw new Error(`Optimizer selected unpromoted Taxi player(s) after promotion read-back: ${stillTaxi.join(", ")}`);
  }
  return { snapshot: refreshed, proposal: refreshedProposal, promotedIds: taxiIds };
}

async function processInitialLineup(league, cookie, snapshot, pool, firstKickoff, base) {
  if (!isInitialLineupRunDue(now, firstKickoff)) {
    return { ...base, status: "idle", message: "Not the 6:00 a.m. ET first-game-day safety-net window." };
  }
  const submission = await readSubmissionStatus(league, snapshot.week, cookie);
  if (submission.status === "unknown") throw new Error(`Could not prove lineup submission status: ${submission.detail}`);
  if (submission.status === "submitted") {
    return { ...base, status: "ok", message: `Manual Week ${snapshot.week} submission found: ${submission.detail}` };
  }
  const rules = parseRules(snapshot.leagueData.league);
  const proposal = optimizeLineup({ players: pool, rules });
  const validation = validateLineup(proposal.players, rules);
  if (!validation.valid) throw new Error(`Initial optimizer produced an illegal lineup: ${validation.errors.join("; ")}`);
  const proposedIds = proposal.players.map((p) => p.id).sort();
  const names = proposal.players.slice().sort((a, b) => a.position.localeCompare(b.position) || b.projection - a.projection)
    .map((p) => `${p.name} ${p.team} ${p.position} (${projectionLabel(p)})`).join("; ");
  if (dryRun) {
    event(league.key, "INITIAL LINEUP DRY RUN", names);
    return { ...base, status: "changed", message: `Dry run would submit: ${names}` };
  }
  const fresh = await readLeague(league, cookie);
  const freshStatus = await readSubmissionStatus(league, snapshot.week, cookie);
  if (fresh.week !== snapshot.week || freshStatus.status !== "not_submitted") {
    throw new Error("Week or submission status changed during evaluation; refusing automatic initial submission");
  }
  const freshPool = getPlayerRows({
    ...fresh,
    starters: fresh.franchise,
    byeTeams: getByeTeams(fresh.byes),
    now,
  });
  const freshRules = parseRules(fresh.leagueData.league);
  const freshProposal = optimizeLineup({ players: freshPool, rules: freshRules });
  const prepared = await promoteTaxiSelections({ league, cookie, snapshot: fresh, proposal: freshProposal, rules: freshRules });
  const finalIds = prepared.proposal.players.map((player) => player.id).sort();
  const finalNames = prepared.proposal.players.slice()
    .sort((a, b) => a.position.localeCompare(b.position) || b.projection - a.projection)
    .map((player) => `${player.name} ${player.team} ${player.position} (${projectionLabel(player)})`).join("; ");
  const promotedNames = prepared.promotedIds.map((id) => freshPool.find((player) => player.id === id)?.name || id);
  const promotionNote = prepared.promotedIds.length
    ? `\n\nPromoted from Taxi to Active before lineup submission: ${promotedNames.join(", ")}.`
    : "";
  await submitLineup({ season, webHost: league.webHost, leagueId: league.leagueId, week: snapshot.week, starterIds: finalIds, cookie });
  const verified = await readLeague(league, cookie);
  const verifiedIds = String(verified.franchise.starters || "").split(",").filter(Boolean).sort();
  if (verifiedIds.join(",") !== finalIds.join(",")) throw new Error("MFL read-back did not match automatic initial lineup");
  event(league.key, "INITIAL LINEUP SUBMITTED", finalNames);
  await sendMflEmail({
    season, webHost: league.webHost, leagueId: league.leagueId, franchiseId: league.franchiseId, cookie,
    subject: `[${league.key} Bears] Automatic Week ${snapshot.week} lineup submitted`,
    message: `No manual Week ${snapshot.week} lineup submission was recorded by 6:00 a.m. ET on the first NFL game day.\n\nThe lineup guardian submitted and verified the highest-projected legal lineup containing no MFL O, IR, H, S, or bye players.${promotionNote}\n\n${finalNames}`,
  });
  return { ...base, status: "changed", message: `Automatic initial lineup submitted and verified for Week ${snapshot.week}.` };
}

async function processLeague(league, cookie) {
  const snapshot = await readLeague(league, cookie);
  const byeTeams = getByeTeams(snapshot.byes);
  const pool = getPlayerRows({ ...snapshot, starters: snapshot.franchise, byeTeams, now });
  const allKickoffs = [...snapshot.kickoffs.values()].sort((a, b) => a - b);
  const nextKickoff = allKickoffs.find((date) => date > now);
  const inAnyRosterWindow = pool.some((p) => p.kickoff && isInWindow(p.kickoff));
  const firstKickoffWindow = allKickoffs.length > 0 && isInWindow(allKickoffs[0]);
  const unavailableStarters = pool.filter((p) => p.starter && isUnavailable(p));
  const dueUnavailable = unavailableStarters.filter((p) =>
    (p.bye && firstKickoffWindow) ||
    (p.kickoff && isInWindow(p.kickoff)) ||
    (!p.bye && !p.kickoff && (inAnyRosterWindow || firstKickoffWindow)));
  const base = { key: league.key, week: snapshot.week, checkedAt: now.toISOString(), nextKickoff: nextKickoff?.toISOString() };

  if (runMode === "initial") return processInitialLineup(league, cookie, snapshot, pool, allKickoffs[0], base);
  if (runMode === "noop") {
    if (dryRun) throw new Error("No-op submission requires an explicit live=true workflow dispatch");
    const existingIds = String(snapshot.franchise.starters || "").split(",").filter(Boolean).sort();
    if (!existingIds.length) throw new Error(`No existing Week ${snapshot.week} lineup is available for a no-op test`);
    const fresh = await readLeague(league, cookie);
    const freshIds = String(fresh.franchise.starters || "").split(",").filter(Boolean).sort();
    if (fresh.week !== snapshot.week || freshIds.join(",") !== existingIds.join(",")) {
      throw new Error("Lineup or week changed during no-op verification; refusing write");
    }
    await submitLineup({
      season, webHost: league.webHost, leagueId: league.leagueId, week: snapshot.week,
      starterIds: existingIds, cookie,
    });
    const verified = await readLeague(league, cookie);
    const verifiedIds = String(verified.franchise.starters || "").split(",").filter(Boolean).sort();
    if (verifiedIds.join(",") !== existingIds.join(",")) throw new Error("No-op MFL read-back changed starter IDs");
    event(league.key, "NO-OP SUBMISSION VERIFIED", `${existingIds.length} unchanged Week ${snapshot.week} starters`);
    return { ...base, status: "ok", message: `End-to-end submission verified with ${existingIds.length} unchanged starters.` };
  }

  if (!inAnyRosterWindow && !firstKickoffWindow) return { ...base, status: "idle", message: "Outside the 90-minute monitoring window." };
  if (!dueUnavailable.length) {
    const detail = `Week ${snapshot.week}: fresh roster, injury, bye, lineup, kickoff, and projection checks passed`;
    event(league.key, "ACTIVE WINDOW CHECK PASSED", detail);
    return { ...base, status: "ok", message: `${detail}.` };
  }

  const rules = parseRules(snapshot.leagueData.league);
  const currentStarterIds = pool.filter((p) => p.starter).map((p) => p.id);
  const lockedStarterIds = pool.filter((p) => p.starter && p.gameLocked).map((p) => p.id);
  const proposal = optimizeLineup({ players: pool, rules, lockedStarterIds, currentStarterIds });
  const validation = validateLineup(proposal.players, rules);
  if (!validation.valid) throw new Error(`Optimizer produced an illegal lineup: ${validation.errors.join("; ")}`);
  const proposedIds = proposal.players.map((p) => p.id).sort();
  const describe = (sourcePool, ids) => {
    const removed = sourcePool.filter((player) => player.starter && !ids.includes(player.id));
    const added = sourcePool.filter((player) => !player.starter && ids.includes(player.id));
    return `${removed.map((player) => `${player.name} ${player.team} ${player.position} (${player.bye ? "BYE" : player.injuryStatus})`).join(", ")} -> ${added.map((player) => `${player.name} ${player.team} ${player.position} (${projectionLabel(player)})`).join(", ")}`;
  };
  const detail = describe(pool, proposedIds);
  if (dryRun) {
    event(league.key, "DRY RUN", detail);
    return { ...base, status: "changed", message: `Dry run: ${detail}` };
  }

  // Close the stale-data gap: all inputs are fetched again immediately before writing.
  const fresh = await readLeague(league, cookie);
  const freshFranchise = fresh.franchise;
  const freshStarters = String(freshFranchise.starters || "").split(",").filter(Boolean).sort();
  if (fresh.week !== snapshot.week || freshStarters.join(",") !== currentStarterIds.sort().join(",")) {
    throw new Error("Lineup or week changed during evaluation; refusing stale write");
  }
  const freshByeTeams = getByeTeams(fresh.byes);
  const freshPool = getPlayerRows({ ...fresh, starters: fresh.franchise, byeTeams: freshByeTeams, now });
  const freshUnavailable = freshPool.filter((player) => player.starter && isUnavailable(player) && !player.gameLocked);
  if (!freshUnavailable.length) {
    return { ...base, status: "ok", message: "Fresh pre-write check found no remaining unlocked inactive starter." };
  }
  const freshLockedIds = freshPool.filter((player) => player.starter && player.gameLocked).map((player) => player.id);
  const freshProposal = optimizeLineup({
    players: freshPool,
    rules: parseRules(fresh.leagueData.league),
    lockedStarterIds: freshLockedIds,
    currentStarterIds: freshStarters,
  });
  const prepared = await promoteTaxiSelections({
    league, cookie, snapshot: fresh, proposal: freshProposal,
    rules: parseRules(fresh.leagueData.league), currentStarterIds: freshStarters,
  });
  const finalIds = prepared.proposal.players.map((player) => player.id).sort();
  const finalValidation = validateLineup(prepared.proposal.players, parseRules(prepared.snapshot.leagueData.league));
  if (!finalValidation.valid) throw new Error(`Fresh optimizer produced an illegal lineup: ${finalValidation.errors.join("; ")}`);
  const finalDetail = describe(freshPool, finalIds);
  const promotedNames = prepared.promotedIds.map((id) => freshPool.find((player) => player.id === id)?.name || id);
  await submitLineup({ season, webHost: league.webHost, leagueId: league.leagueId, week: snapshot.week, starterIds: finalIds, cookie });
  const verified = await readLeague(league, cookie);
  const verifiedIds = String(verified.franchise.starters || "").split(",").filter(Boolean).sort();
  if (verifiedIds.join(",") !== finalIds.join(",")) throw new Error("MFL read-back did not match submitted lineup");
  const verifiedPool = getPlayerRows({
    ...verified,
    starters: verified.franchise,
    byeTeams: getByeTeams(verified.byes),
    now,
  });
  const badReadBack = verifiedPool.filter((player) =>
    player.starter && !player.gameLocked && isUnavailable(player));
  if (badReadBack.length) {
    throw new Error(`MFL read-back still contains unlocked inactive starter(s): ${badReadBack.map((player) =>
      `${player.name} (${player.bye ? "BYE" : player.injuryStatus})`).join(", ")}`);
  }
  event(league.key, "LINEUP UPDATED", finalDetail);
  await sendMflEmail({
    season, webHost: league.webHost, leagueId: league.leagueId, franchiseId: league.franchiseId, cookie,
    subject: `[${league.key} Bears] Automatic lineup protection applied`,
    message: `The lineup guardian made and verified this change for Week ${snapshot.week}:\n\n${finalDetail}${prepared.promotedIds.length ? `\n\nPromoted from Taxi to Active before lineup submission: ${promotedNames.join(", ")}.` : ""}\n\nThe resulting 21-player lineup passed every league position and group constraint.`,
  });
  return { ...base, status: "changed", message: finalDetail };
}

async function main() {
  const { username, password } = requireCredentials();
  const cookie = await login(season, username, password);
  const leagues = loadLeagues();
  await verifyLogin(season, cookie, leagues);
  const results = [];
  for (const league of leagues) {
    try { results.push(await processLeague(league, cookie)); }
    catch (error) {
      event(league.key, "ERROR", error.message);
      results.push({ key: league.key, status: "error", week: "?", checkedAt: now.toISOString(), message: error.message });
      try {
        await sendMflEmail({
          season, webHost: league.webHost, leagueId: league.leagueId, franchiseId: league.franchiseId, cookie,
          subject: `[${league.key} Bears] Lineup guardian needs attention`,
          message: `The lineup guardian refused to make a lineup change.\n\n${error.message}\n\nPlease inspect the lineup manually.`,
        });
      } catch (emailError) { console.error(`Could not send MFL failure email: ${emailError.message}`); }
      process.exitCode = 1;
    }
  }
  state.leagues = results;
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  writeDashboard(state);
  console.log(JSON.stringify({ dryRun, runMode, now: now.toISOString(), results }, null, 2));
}

await main();
