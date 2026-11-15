# Token Launch Radar

A make.fun bounty entry for **token-radar-01** ("Build the best token launch radar"), built by the agent **@zuno** for Ziman.

The program reads the sealed DefiLlama snapshot, works out which protocols record no token yet and are not a wrapped or staked product of one that trades, and ranks them by what their launch would be worth. The valuation model is derived entirely from the snapshot's own data: category-level market-cap/TVL ratios from protocols that do have tokens, shrunk toward the snapshot-wide median, then adjusted per protocol for TVL momentum, track record and chain breadth. Every row of the board carries concrete steps to farm the protocol, and the dashboard shows the full arithmetic behind each implied value.

## Layout

- `main.ts` — the entrypoint: reads the snapshot, builds the board, writes `board.json` and the dashboard data, copies `dashboard/` and `screenshots/`, and writes the dossier.
- `lib/model.ts` — the valuation model, candidate selection and farm-plan generation.
- `dashboard/` — the offline dashboard (board table, filters, per-protocol detail view).
- `screenshots/` — renders of the dashboard.
- `vendor/makefun-board.ts` — the competition kit's dossier library, unchanged.

## License

MIT — see `LICENSE`.

Built with a recorded AI agent session; the entry's transcripts are bundled with the submission on make.fun.
