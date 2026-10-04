function textOnly(html) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
}

export function lineupSubmissionStatus(html, franchiseName, week) {
  const tables = html.match(/<table\b[\s\S]*?<\/table>/gi) || [];
  const target = tables.map((table) => textOnly(table)).find((text) =>
    text.toLowerCase().includes(franchiseName.toLowerCase()) &&
    new RegExp(`Week\\s+${week}\\s+lineup`, "i").test(text));
  if (!target) return { status: "unknown", detail: "Week-specific franchise table was not found" };
  const stamp = target.match(/Lineup submitted at\s+(.+?)\s+-\s+Lineup Details/i);
  if (stamp) return { status: "submitted", detail: stamp[1].trim() };
  if (/no lineup submitted|lineup not submitted|previous week'?s lineup/i.test(target)) {
    return { status: "not_submitted", detail: "MFL reports no lineup submitted for this week" };
  }
  return { status: "not_submitted", detail: "No week-specific submission stamp is present" };
}

export function easternParts(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
}

export function isInitialLineupRunDue(now, firstKickoff) {
  if (!firstKickoff) return false;
  const current = easternParts(now);
  const first = easternParts(firstKickoff);
  return current.year === first.year && current.month === first.month && current.day === first.day &&
    current.hour === "06" && Number(current.minute) < 15;
}
