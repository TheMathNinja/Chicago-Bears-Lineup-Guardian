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

The GitHub schedule is a backup heartbeat. The installed Google Apps Script checks MFL's public current-week NFL schedule every five minutes and invokes GitHub only within an actual 90-minute kickoff window (plus the 6:00 a.m. first-game-day safety check). GitHub rate-limit responses pause precision dispatches until the advertised reset while the native backup remains available. MFL's verbose injury values (for example `Out`, `Suspended`, and `Holdout`) are normalized to the website's `O`, `S`, and `H` designations before lineup eligibility is evaluated.

At 6:00 a.m. Eastern on the date of each week's first NFL game, a separate safety-net workflow checks MFL's week-specific submission stamp. If no manual submission exists, it builds, submits, reads back, and emails confirmation of the highest-projected legal lineup with no `O`, `IR`, `H`, `S`, or bye players.

## Required repository secrets

- `MFL_USERNAME`
- `MFL_PASSWORD`

Set repository variable `LIVE_LINEUP_WRITES=true` only after the dry-run report and authenticated no-op test pass. The primary Apps Script dispatcher explicitly requests live mode; the GitHub cron reads the repository variable.
