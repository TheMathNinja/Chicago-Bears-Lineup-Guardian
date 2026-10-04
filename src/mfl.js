const BASE = "https://api.myfantasyleague.com";

async function request(url, { cookie, method = "GET", body } = {}) {
  const headers = { "User-Agent": "Chicago-Bears-Lineup-Guardian/0.1" };
  if (cookie) headers.Cookie = `MFL_USER_ID=${cookie}`;
  if (body) headers["Content-Type"] = "application/x-www-form-urlencoded";
  const response = await fetch(url, { method, headers, body });
  const text = await response.text();
  if (!response.ok) throw new Error(`MFL ${response.status} for ${url}: ${text.slice(0, 300)}`);
  return text;
}

export async function requestText(url, cookie) {
  return request(url, { cookie });
}

export async function login(season, username, password) {
  const params = new URLSearchParams({ USERNAME: username, PASSWORD: password, XML: "1" });
  const text = await request(`${BASE}/${season}/login`, { method: "POST", body: params });
  const match = text.match(/\bMFL_USER_ID=["']([^"']+)["']/i);
  if (!match) throw new Error(`MFL login failed: ${text.slice(0, 300) || "empty response"}`);
  const xmlDecoded = match[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  let decoded = xmlDecoded;
  try { decoded = decodeURIComponent(xmlDecoded); } catch { /* Already decoded. */ }
  return encodeURIComponent(decoded);
}

export async function verifyLogin(season, cookie, expectedLeagueIds) {
  const data = await exportJson(season, "myleagues", { YEAR: season, FRANCHISE_NAMES: "1" }, cookie);
  const leagues = data.myleagues?.league ?? data.leagues?.league ?? data.league;
  const ids = new Set((Array.isArray(leagues) ? leagues : leagues ? [leagues] : [])
    .map((league) => league.id ?? league.league_id ?? league.leagueId)
    .filter(Boolean)
    .map(String));
  const missing = expectedLeagueIds.filter((id) => !ids.has(String(id)));
  if (missing.length) throw new Error(`Authenticated MFL account cannot access league(s): ${missing.join(", ")}`);
}

export async function exportJson(season, type, params = {}, cookie) {
  const query = new URLSearchParams({ TYPE: type, JSON: "1", ...params });
  return JSON.parse(await request(`${BASE}/${season}/export?${query}`, { cookie }));
}

export async function submitLineup({ season, leagueId, franchiseId, week, starterIds, cookie, comments = "Automated inactive-player protection" }) {
  const query = new URLSearchParams({
    TYPE: "lineup",
    L: leagueId,
    W: String(week),
    STARTERS: starterIds.join(","),
    FRANCHISE_ID: franchiseId,
    COMMENTS: comments,
    JSON: "1",
  });
  const text = await request(`${BASE}/${season}/import?${query}`, { cookie });
  let result;
  try { result = JSON.parse(text); } catch { result = { raw: text }; }
  if (/error/i.test(text)) throw new Error(`MFL rejected lineup: ${text.slice(0, 500)}`);
  return result;
}

export async function sendMflEmail({ season, leagueId, franchiseId, subject, message, cookie }) {
  const query = new URLSearchParams({
    TYPE: "emailMessage",
    L: leagueId, SEND_TO: franchiseId,
    SUBJECT: subject, BODY: message, JSON: "1",
  });
  const text = await request(`${BASE}/${season}/import?${query}`, { cookie });
  if (/error/i.test(text)) throw new Error(`MFL rejected notification email: ${text.slice(0, 500)}`);
}
