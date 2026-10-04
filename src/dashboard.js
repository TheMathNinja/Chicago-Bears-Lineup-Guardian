import fs from "node:fs";
import path from "node:path";

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function writeDashboard(state) {
  fs.mkdirSync("docs", { recursive: true });
  const cards = state.leagues.map((league) => `
    <section>
      <header><h2>${esc(league.key)} Chicago Bears</h2><span class="status ${esc(league.status)}">${esc(league.status)}</span></header>
      <dl><dt>Week</dt><dd>${esc(league.week)}</dd><dt>Last checked</dt><dd>${esc(league.checkedAt)}</dd><dt>Next kickoff</dt><dd>${esc(league.nextKickoff || "None")}</dd></dl>
      <p>${esc(league.message)}</p>
    </section>`).join("");
  const events = [...state.events].reverse().slice(0, 100).map((event) => `<tr><td>${esc(event.time)}</td><td>${esc(event.league)}</td><td>${esc(event.action)}</td><td>${esc(event.detail)}</td></tr>`).join("");
  fs.writeFileSync(path.resolve("docs/index.html"), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Chicago Bears Lineup Guardian</title><style>
  :root{font-family:Inter,system-ui,sans-serif;color:#17202a;background:#f3f5f7}body{margin:0}main{max-width:1100px;margin:auto;padding:24px}h1{font-size:28px;margin:0 0 6px}h2{font-size:18px;margin:0}p{line-height:1.5}small{color:#5f6b76}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px;margin:24px 0}section{background:white;border:1px solid #dce1e5;border-radius:8px;padding:18px}header{display:flex;align-items:center;justify-content:space-between;gap:12px}.status{font-size:12px;font-weight:700;text-transform:uppercase}.ok{color:#14713b}.changed{color:#a04a00}.error{color:#a51d2d}.idle{color:#58636e}dl{display:grid;grid-template-columns:120px 1fr;gap:8px;margin:18px 0}dt{color:#5f6b76}dd{margin:0;font-weight:600}table{width:100%;border-collapse:collapse;background:white;border:1px solid #dce1e5}th,td{text-align:left;padding:10px;border-bottom:1px solid #e6eaed;font-size:13px}th{background:#f8f9fa}</style></head><body><main><h1>Chicago Bears Lineup Guardian</h1><small>ADL and FAFL automatic inactive-player protection</small><div class="grid">${cards}</div><h2>Audit Log</h2><table><thead><tr><th>Time</th><th>League</th><th>Action</th><th>Detail</th></tr></thead><tbody>${events || '<tr><td colspan="4">No events yet.</td></tr>'}</tbody></table></main></body></html>`);
}
