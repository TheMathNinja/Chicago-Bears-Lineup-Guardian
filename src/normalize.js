const ILLEGAL = new Set(["O", "IR", "IR-R", "IR-D", "IR-PUP", "PUP", "H", "S"]);

export function normalizeStatus(value) {
  const status = String(value || "").trim().toUpperCase();
  if (!status) return "";
  if (status.startsWith("IR") || status === "PUP") return "IR";
  return status.replace(/[()]/g, "");
}

export function isUnavailable({ injuryStatus, bye }) {
  const raw = String(injuryStatus || "").trim().toUpperCase().replace(/[()]/g, "");
  return Boolean(bye) || ILLEGAL.has(raw) || raw.startsWith("IR");
}

export function rows(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}
