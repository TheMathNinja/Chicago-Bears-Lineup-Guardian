const BASE = "https://api.myfantasyleague.com";

async function request(url, { cookie, method = "GET", body } = {}) {
  const headers = { "User-Agent": "Chicago-Bears-Lineup-Guardian/0.1" };
  if (cookie) headers.Cookie = `MFL_USER_ID=${encodeURIComponent(cookie)}`;
  if (body) headers["Content-Type"] = "application/x-www-form-urlencoded";
  const response = await fetch(url, { method, headers, body });
  const text = await response.text();
  if (!response.ok) throw new Error(`MFL ${response.status} for ${url}: ${text.slice(0, 300)}`);
  return text;
}

export async function login(season, username, password) {
  const params = new URLSearchParams({ USERNAME: username, PASSWORD: password, JSON: "1" });
  const data = JSON.parse(await request(`${BASE}/${season}/login`, { method: "POST", body: params }));
  const cookie = data.MFL_USER_ID || data.login?.MFL_USER_ID;
  if (!cookie) throw new Error(`MFL login failed: ${JSON.stringify(data).slice(0, 300)}`);
  return cookie;
}

export async function exportJson(season, type, params = {}, cookie) {
  const query = new URLSearchParams({ TYPE: type, JSON: "1", ...params });
  return JSON.parse(await request(`${BASE}/${season}/export?${query}`, { cookie }));
}

export async function submitLineup({ season, leagueId, week, starterIds, cookie }) {
  const body = new URLSearchParams({
    TYPE: "lineup",
    L: leagueId,
    W: String(week),
    STARTERS: starterIds.join(","),
    COMMENTS: "Automated inactive-player protection",
    JSON: "1",
  });
  const text = await request(`${BASE}/${season}/import`, { cookie, method: "POST", body });
  let result;
  try { result = JSON.parse(text); } catch { result = { raw: text }; }
  if (/error/i.test(text)) throw new Error(`MFL rejected lineup: ${text.slice(0, 500)}`);
  return result;
}

export async function sendMflEmail({ season, leagueId, franchiseId, subject, message, cookie }) {
  const body = new URLSearchParams({
    TYPE: "emailMessage", L: leagueId, SEND_TO: franchiseId,
    SUBJECT: subject, BODY: message, JSON: "1",
  });
  const text = await request(`${BASE}/${season}/import`, { cookie, method: "POST", body });
  if (/error/i.test(text)) throw new Error(`MFL rejected notification email: ${text.slice(0, 500)}`);
}
