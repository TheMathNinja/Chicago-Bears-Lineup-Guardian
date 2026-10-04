# Chicago Bears Lineup Guardian

Personal game-day lineup protection for franchise `0005` in ADL (`60206`) and FAFL (`22686`).

The guardian polls during NFL game windows, identifies unavailable starters, and computes the highest-projected **complete legal lineup**. It searches every eligible starting position instead of requiring a same-position replacement. Locked starters are preserved.

## Safety contract

- `LIVE_LINEUP_WRITES` defaults to `false`.
- Data is fetched again immediately before any write.
- A proposal must pass every MFL lineup constraint.
- A submitted lineup must be read back and match exactly.
- Every decision is recorded in `data/events.json` and rendered in `docs/index.html`.
- Any unavailable starter with no legal replacement produces an urgent alert and no partial write.

The GitHub schedule is a backup heartbeat. A Google Apps Script dispatcher should invoke this workflow on exact ten-minute boundaries; the worker exits immediately outside an active 90-minute game window.

## Required repository secrets

- `MFL_USERNAME`
- `MFL_PASSWORD`

Set repository variable `LIVE_LINEUP_WRITES=true` only after the dry-run report and authenticated no-op test pass. The primary Apps Script dispatcher explicitly requests live mode; the GitHub cron reads the repository variable.
