import test from "node:test";
import assert from "node:assert/strict";

test("MFL XML login response shape is documented", () => {
  const xml = '<status MFL_USER_ID="cookie-value" />';
  const match = xml.match(/\bMFL_USER_ID=["']([^"']+)["']/i);
  assert.equal(match[1], "cookie-value");
});
