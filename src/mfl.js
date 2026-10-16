const BASE = "https://api.myfantasyleague.com";
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function request(url, { cookie, method = "GET", body } = {}) {
  const headers = { "User-Agent": "Chicago-Bears-Lineup-Guardian/0.1" };
  if (cookie) headers.Cookie = `MFL_USER_ID=${cookie}`;
  if (body) headers["Content-Type"] = "application/x-www-form-urlencoded";
  const mayRetry = method === "GET" || /\/login(?:\?|$)/.test(url);
  const maxAttempts = mayRetry ? 4 : 1;
  const retryBaseMs = Number(process.env.MFL_RETRY_BASE_MS || 1000);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response;
    try {
      response = await fetch(url, { method, headers, body });
    } catch (error) {
      const retryable = mayRetry && attempt < maxAttempts;
      if (!retryable) {
        throw new Error(`MFL network request failed for ${url} after ${attempt} attempt(s): ${error.message}`, { cause: error });
      }
      console.warn(`MFL network error; retrying ${url} (attempt ${attempt + 1}/${maxAttempts}): ${error.message}`);
      await wait(retryBaseMs * (2 ** (attempt - 1)));
      continue;
    }
    const text = await response.text();
    if (response.ok) return text;

    const retryable = mayRetry && RETRYABLE_STATUS.has(response.status) && attempt < maxAttempts;
    if (!retryable) {
      throw new Error(`MFL ${response.status} for ${url}: ${text.slice(0, 300)}`);
    }
    console.warn(`MFL ${response.status}; retrying ${url} (attempt ${attempt + 1}/${maxAttempts})`);
    await wait(retryBaseMs * (2 ** (attempt - 1)));
  }

  throw new Error(`MFL request exhausted retries for ${url}`);
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

export async function verifyLogin(season, cookie, expectedLeagues) {
  const data = await exportJson(season, "myleagues", { YEAR: season, FRANCHISE_NAMES: "1" }, cookie);
  const leagues = data.myleagues?.league ?? data.leagues?.league ?? data.league;
  const memberships = (Array.isArray(leagues) ? leagues : leagues ? [leagues] : []).map((league) => ({
    leagueId: String(league.id ?? league.league_id ?? league.leagueId ?? ""),
    franchiseId: String(league.franchise_id ?? league.franchiseId ?? league.franchise?.id ?? ""),
  }));
  const ids = new Set(memberships.map((league) => league.leagueId).filter(Boolean));
  const missing = expectedLeagues.map((league) => league.leagueId).filter((id) => !ids.has(String(id)));
  if (missing.length) throw new Error(`Authenticated MFL account cannot access league(s): ${missing.join(", ")}`);
  console.log(`MFL memberships: ${expectedLeagues.map((expected) => {
    const membership = memberships.find((league) => league.leagueId === String(expected.leagueId));
    return `${expected.key}=${membership?.franchiseId || "no owner franchise returned"}`;
  }).join("; ")}`);
}

export async function exportJson(season, type, params = {}, cookie) {
  const query = new URLSearchParams({ TYPE: type, JSON: "1", ...params });
  return JSON.parse(await request(`${BASE}/${season}/export?${query}`, { cookie }));
}

export async function submitLineup({ season, webHost, leagueId, week, starterIds, cookie }) {
  const body = new URLSearchParams({
    W: String(week),
    STARTERS: starterIds.join(","),
    JSON: "1",
  });
  const text = await request(`https://${webHost}/${season}/import?TYPE=lineup&L=${encodeURIComponent(leagueId)}`, {
    cookie, method: "POST", body,
  });
  let result;
  try { result = JSON.parse(text); } catch { result = { raw: text }; }
  if (/error/i.test(text)) throw new Error(`MFL rejected lineup: ${text.slice(0, 500)}`);
  return result;
}

export async function sendMflEmail({ season, webHost, leagueId, franchiseId, subject, message, cookie }) {
  const body = new URLSearchParams({
    SEND_TO: franchiseId,
    SUBJECT: subject, BODY: message, JSON: "1",
  });
  const text = await request(`https://${webHost}/${season}/import?TYPE=emailMessage&L=${encodeURIComponent(leagueId)}`, {
    cookie, method: "POST", body,
  });
  if (/error/i.test(text)) throw new Error(`MFL rejected notification email: ${text.slice(0, 500)}`);
}
