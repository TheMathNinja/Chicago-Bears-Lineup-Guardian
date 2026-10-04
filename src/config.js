import fs from "node:fs";
import path from "node:path";

export const season = Number(process.env.SEASON || new Date().getFullYear());
export const dryRun = String(process.env.LIVE_LINEUP_WRITES || "false").toLowerCase() !== "true";
export const lookaheadMinutes = Number(process.env.LOOKAHEAD_MINUTES || 90);

export function loadLeagues() {
  return JSON.parse(fs.readFileSync(path.resolve("config/leagues.json"), "utf8"));
}

export function requireCredentials() {
  const username = process.env.MFL_USERNAME;
  const password = process.env.MFL_PASSWORD;
  if (!username || !password) throw new Error("MFL_USERNAME and MFL_PASSWORD are required");
  return { username, password };
}
