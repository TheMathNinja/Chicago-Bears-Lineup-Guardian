import test from "node:test";
import assert from "node:assert/strict";
import { getByeTeams, getPlayerRows, mapKickoffs } from "../src/lineup-data.js";

function fixture({ injury = "Out", starter = true, rosterStatus = "ROSTER" } = {}) {
  const kickoff = Date.parse("2026-11-01T21:25:00Z") / 1000;
  const playerId = "16194";
  return {
    now: new Date("2026-11-01T20:00:00Z"),
    playerId,
    players: { players: { player: { id: playerId, name: "Rice, Rashee", team: "KCC", position: "WR" } } },
    roster: { rosters: { franchise: { player: { id: playerId, status: rosterStatus } } } },
    injuries: { injuries: { injury: { id: playerId, status: injury } } },
    projections: { projectedScores: { playerScore: { id: playerId, score: "14.2" } } },
    starters: { starters: starter ? `${playerId},` : "" },
    schedule: { nflSchedule: { matchup: { kickoff: String(kickoff), team: [{ id: "KCC" }, { id: "DEN" }] } } },
    byes: { nflByeWeeks: { team: [] } },
  };
}

test("joins an MFL Out designation to Rashee Rice by player id", () => {
  const data = fixture();
  const kickoffs = mapKickoffs(data.schedule);
  const byeTeams = getByeTeams(data.byes);
  const [rice] = getPlayerRows({ ...data, kickoffs, byeTeams });
  assert.equal(rice.starter, true);
  assert.equal(rice.injuryStatus, "O");
  assert.equal(rice.eligible, false);
  assert.equal(rice.kickoff.toISOString(), "2026-11-01T21:25:00.000Z");
});

test("bye starters are unavailable even without an injury designation", () => {
  const data = fixture({ injury: "" });
  data.byes = { nflByeWeeks: { team: { id: "KCC" } } };
  const [rice] = getPlayerRows({ ...data, kickoffs: mapKickoffs(data.schedule), byeTeams: getByeTeams(data.byes) });
  assert.equal(rice.bye, true);
  assert.equal(rice.eligible, false);
});

test("IR and taxi players cannot be selected as replacements", () => {
  for (const rosterStatus of ["INJURED_RESERVE", "TAXI_SQUAD"]) {
    const data = fixture({ injury: "", starter: false, rosterStatus });
    const [rice] = getPlayerRows({ ...data, kickoffs: mapKickoffs(data.schedule), byeTeams: getByeTeams(data.byes) });
    assert.equal(rice.eligible, false);
  }
});
