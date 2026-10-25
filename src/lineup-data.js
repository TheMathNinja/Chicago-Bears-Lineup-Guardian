import { isUnavailable, normalizeStatus, rows } from "./normalize.js";

export function mapKickoffs(schedule) {
  const map = new Map();
  for (const matchup of rows(schedule.nflSchedule?.matchup)) {
    const kickoff = new Date(Number(matchup.kickoff) * 1000);
    for (const team of rows(matchup.team)) map.set(team.id, kickoff);
  }
  return map;
}

export function getByeTeams(byes) {
  return new Set(rows(byes.nflByeWeeks?.team).map((team) => team.id));
}

export function getPlayerRows({ players, roster, injuries, projections, starters, kickoffs, byeTeams, now }) {
  const playerMap = new Map(rows(players.players?.player).map((player) => [player.id, player]));
  const injuryMap = new Map(rows(injuries.injuries?.injury).map((injury) => [injury.id, injury.status]));
  const projectionMap = new Map(rows(projections.projectedScores?.playerScore)
    .map((player) => [player.id, Number(player.score)]));
  const starterIds = new Set(String(starters.starters || "").split(",").filter(Boolean));
  return rows(roster.rosters?.franchise?.player).map((rosterPlayer) => {
    const player = playerMap.get(rosterPlayer.id) || {};
    const injuryStatus = normalizeStatus(injuryMap.get(rosterPlayer.id));
    const bye = byeTeams.has(player.team);
    const kickoff = kickoffs.get(player.team);
    const gameLocked = Boolean(kickoff && kickoff <= now);
    const lineupEligibleList = rosterPlayer.status === "ROSTER" || rosterPlayer.status === "TAXI_SQUAD";
    return {
      id: rosterPlayer.id,
      name: player.name || rosterPlayer.id,
      team: player.team || "",
      position: player.position || "",
      projection: projectionMap.get(rosterPlayer.id) ?? Number.NEGATIVE_INFINITY,
      injuryStatus,
      bye,
      kickoff,
      starter: starterIds.has(rosterPlayer.id),
      gameLocked,
      rosterStatus: rosterPlayer.status,
      eligible: lineupEligibleList && !gameLocked && !isUnavailable({ injuryStatus, bye }),
    };
  });
}
