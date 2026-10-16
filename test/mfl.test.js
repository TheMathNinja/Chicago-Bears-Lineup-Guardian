import test from "node:test";
import assert from "node:assert/strict";
import { login, requestText } from "../src/mfl.js";

test("MFL XML login response shape is documented", () => {
  const xml = '<status MFL_USER_ID="cookie-value" />';
  const match = xml.match(/\bMFL_USER_ID=["']([^"']+)["']/i);
  assert.equal(match[1], "cookie-value");
});

test("MFL login retries a temporary service outage", async (t) => {
  const originalFetch = global.fetch;
  const originalDelay = process.env.MFL_RETRY_BASE_MS;
  t.after(() => {
    global.fetch = originalFetch;
    if (originalDelay === undefined) delete process.env.MFL_RETRY_BASE_MS;
    else process.env.MFL_RETRY_BASE_MS = originalDelay;
  });

  process.env.MFL_RETRY_BASE_MS = "1";
  let attempts = 0;
  global.fetch = async () => {
    attempts += 1;
    if (attempts === 1) return new Response("maintenance", { status: 503 });
    return new Response('<status MFL_USER_ID="cookie-value" />', { status: 200 });
  };

  assert.equal(await login(2026, "user", "password"), "cookie-value");
  assert.equal(attempts, 2);
});

test("MFL login retries a connection timeout", async (t) => {
  const originalFetch = global.fetch;
  const originalDelay = process.env.MFL_RETRY_BASE_MS;
  t.after(() => {
    global.fetch = originalFetch;
    if (originalDelay === undefined) delete process.env.MFL_RETRY_BASE_MS;
    else process.env.MFL_RETRY_BASE_MS = originalDelay;
  });

  process.env.MFL_RETRY_BASE_MS = "1";
  let attempts = 0;
  global.fetch = async () => {
    attempts += 1;
    if (attempts === 1) throw new TypeError("fetch failed", { cause: { code: "UND_ERR_CONNECT_TIMEOUT" } });
    return new Response('<status MFL_USER_ID="cookie-value" />', { status: 200 });
  };

  assert.equal(await login(2026, "user", "password"), "cookie-value");
  assert.equal(attempts, 2);
});

test("MFL reads stop after bounded network retries", async (t) => {
  const originalFetch = global.fetch;
  const originalDelay = process.env.MFL_RETRY_BASE_MS;
  t.after(() => {
    global.fetch = originalFetch;
    if (originalDelay === undefined) delete process.env.MFL_RETRY_BASE_MS;
    else process.env.MFL_RETRY_BASE_MS = originalDelay;
  });

  process.env.MFL_RETRY_BASE_MS = "1";
  let attempts = 0;
  global.fetch = async () => {
    attempts += 1;
    throw new TypeError("fetch failed", { cause: { code: "UND_ERR_CONNECT_TIMEOUT" } });
  };

  await assert.rejects(() => requestText("https://example.test/read"), /after 4 attempt\(s\)/);
  assert.equal(attempts, 4);
});

test("MFL reads stop after the bounded retry limit", async (t) => {
  const originalFetch = global.fetch;
  const originalDelay = process.env.MFL_RETRY_BASE_MS;
  t.after(() => {
    global.fetch = originalFetch;
    if (originalDelay === undefined) delete process.env.MFL_RETRY_BASE_MS;
    else process.env.MFL_RETRY_BASE_MS = originalDelay;
  });

  process.env.MFL_RETRY_BASE_MS = "1";
  let attempts = 0;
  global.fetch = async () => {
    attempts += 1;
    return new Response("maintenance", { status: 503 });
  };

  await assert.rejects(() => requestText("https://example.test/read"), /MFL 503/);
  assert.equal(attempts, 4);
});
