# THE BIBLE — v8 Updates

## §13 — v8 patch (run-folder layer)

After initial v8 implementation, observed that flat `output/applications/{slug}/`
made it impossible to track which pipeline run produced which artifacts.
Patched to nest under run folders:

  output/applications/{run_label}/{slug}/...

where `run_label` is:
  - pipeline: `{ISO timestamp}_{run_id first 8}`  e.g. `2026-05-14T10-30-15_9e27688e`
  - manual:   `manual_{ISO timestamp}`            e.g. `manual_2026-05-15T09-15-30`

DB unchanged — `tex_path` / `pdf_path` columns store full relative path including run folder.
Existing flat-layout folders stay where they are; new generations land in run folders.

## §13.1 — v8 patch (risk map + ledger, no policy modes)

After v4 fixes, added the tech equivalence risk map at
`config/tech-equivalence-risk-map.json` and wired it into the pipeline as follows:

- `src/risk-map/` module loads the map at startup and exposes lookups + audit
- Judge prompt v4 attaches risk entries to JD skills and emits `tech_swaps`
- Resume + cover letter generators apply `tech_swaps` (Mode B substitution)
- Post-generation audit grades every claim and writes ledger rows
- `meta.json` per artifact has `risk_summary` + `export_status`
- UI shows green/yellow badges based on `export_status` (no red)
- Verifier uses risk map for synonym/equivalent matching

Policy modes (strict / research / chaos_measurement) were specced and dropped
before implementation. Single-user system, total mode is the only intended use.
Risk map data still drives ledger + human_review badges. If we ever multi-user
the system, modes return as a per-user setting.

Tables added:
- fabrication_ledger (one row per claim made by any generation, ever)

UI changes:
- Two badge colors only: green (ok) and yellow (needs_review)
- Clicking yellow opens a panel listing human_review_items + reasons
- PDF links are always active; no export blocking

Ledger query for periodic audit:
  SELECT change_type, COUNT(*) FROM fabrication_ledger
    WHERE created_at > NOW() - INTERVAL '7 days' GROUP BY change_type;
