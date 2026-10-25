const ILLEGAL = new Set(["O", "I", "IR", "IR-R", "IR-D", "IR-PUP", "PUP", "H", "S"]);

export function normalizeStatus(value) {
  const status = String(value || "").trim().toUpperCase().replace(/[()]/g, "");
  if (!status) return "";
  if (status.startsWith("IR") || status.includes("INJURED RESERVE") ||
      status.includes("RESERVE/INJURED") || status.includes("PUP")) return "IR";
  if (status === "OUT") return "O";
  if (status === "HOLDOUT") return "H";
  if (status === "SUSPENDED" || status === "SUSPENSION") return "S";
  return status;
}

export function isUnavailable({ injuryStatus, bye }) {
  const raw = String(injuryStatus || "").trim().toUpperCase().replace(/[()]/g, "");
  return Boolean(bye) || ILLEGAL.has(raw) || raw.startsWith("IR");
}

export function rows(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}
