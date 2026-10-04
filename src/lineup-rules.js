const GROUPS = {
  offense: new Set(["QB", "RB", "WR", "TE"]),
  defense: new Set(["DT", "DE", "LB", "CB", "S"]),
};

export function parseRules(league) {
  const raw = league.starters;
  const positions = Object.fromEntries(raw.position.map(({ name, limit }) => {
    const [min, max = min] = String(limit).split("-").map(Number);
    return [name, { min, max }];
  }));
  return {
    total: Number(raw.count),
    offense: Number(raw.iop_starters),
    defense: Number(raw.idp_starters),
    positions,
  };
}

export function validateLineup(players, rules) {
  const counts = Object.fromEntries(Object.keys(rules.positions).map((p) => [p, 0]));
  for (const player of players) counts[player.position] = (counts[player.position] || 0) + 1;
  const errors = [];
  if (players.length !== rules.total) errors.push(`requires ${rules.total} total starters; found ${players.length}`);
  const offense = players.filter((p) => GROUPS.offense.has(p.position)).length;
  const defense = players.filter((p) => GROUPS.defense.has(p.position)).length;
  if (offense !== rules.offense) errors.push(`requires ${rules.offense} offensive starters; found ${offense}`);
  if (defense !== rules.defense) errors.push(`requires ${rules.defense} defensive starters; found ${defense}`);
  for (const [position, { min, max }] of Object.entries(rules.positions)) {
    if (counts[position] < min || counts[position] > max) {
      errors.push(`${position} requires ${min}-${max}; found ${counts[position]}`);
    }
  }
  return { valid: errors.length === 0, errors, counts, offense, defense };
}

function combinations(items, count) {
  if (count === 0) return [[]];
  if (items.length < count) return [];
  const output = [];
  const visit = (start, picked) => {
    if (picked.length === count) return void output.push([...picked]);
    for (let i = start; i <= items.length - (count - picked.length); i += 1) {
      picked.push(items[i]);
      visit(i + 1, picked);
      picked.pop();
    }
  };
  visit(0, []);
  return output;
}

function positionChoices(players, position, bounds, lockedIds) {
  const pool = players.filter((p) => p.position === position);
  const locked = pool.filter((p) => lockedIds.has(p.id));
  const available = pool.filter((p) => !lockedIds.has(p.id));
  const choices = [];
  for (let total = Math.max(bounds.min, locked.length); total <= bounds.max; total += 1) {
    for (const rest of combinations(available, total - locked.length)) choices.push([...locked, ...rest]);
  }
  return choices;
}

export function optimizeLineup({ players, rules, lockedStarterIds = [], currentStarterIds = [] }) {
  const lockedIds = new Set(lockedStarterIds);
  const eligible = players.filter((p) => p.eligible && Number.isFinite(p.projection));
  const lockedMissing = [...lockedIds].filter((id) => !eligible.some((p) => p.id === id));
  if (lockedMissing.length) throw new Error(`Locked starters are missing or ineligible: ${lockedMissing.join(", ")}`);

  let states = [{ players: [], score: 0 }];
  for (const [position, bounds] of Object.entries(rules.positions)) {
    const choices = positionChoices(eligible, position, bounds, lockedIds);
    const next = [];
    for (const state of states) {
      for (const choice of choices) {
        const combined = [...state.players, ...choice];
        const offense = combined.filter((p) => GROUPS.offense.has(p.position)).length;
        const defense = combined.filter((p) => GROUPS.defense.has(p.position)).length;
        if (combined.length <= rules.total && offense <= rules.offense && defense <= rules.defense) {
          next.push({ players: combined, score: state.score + choice.reduce((s, p) => s + p.projection, 0) });
        }
      }
    }
    states = next;
  }
  const legal = states.filter((s) => validateLineup(s.players, rules).valid);
  const currentIds = new Set(currentStarterIds);
  for (const state of legal) state.retained = state.players.filter((p) => currentIds.has(p.id)).length;
  legal.sort((a, b) => b.retained - a.retained || b.score - a.score || a.players.map((p) => p.id).sort().join().localeCompare(b.players.map((p) => p.id).sort().join()));
  if (!legal.length) throw new Error("No fully legal lineup can be formed from eligible, unlocked players");
  return legal[0];
}
