# jobs — UI redesign (drop-in for `ui/`)

This folder is a **drop-in replacement for the `ui/` part of your repo**. It keeps your
existing build (Vite + React + TypeScript) and — most importantly — your **`api.ts` and every
`/api/*` call is unchanged**, so it talks to your real backend exactly as before. Only the
presentation layer was rewritten.

## What changed

- **New design system** — light by default with a dark toggle, calm Wero-style palette
  (signature `#FFF48D` yellow + warm near-black), Hanken Grotesk / Space Grotesk type, and
  subtle abstract underlayers (faint grid, slow gradient field, grain).
- **Inline-expand job cards** — the old right-side `DetailPanel` is gone; each card expands in
  place to reveal score breakdown, skill match, judge reasoning, job description, cover letter,
  résumé diff, artifacts, and the Yes/Maybe/No + status controls.
- **Fluid scrolling** + **sliding filter indicator** + **tab cross-fade** + staggered card
  entrances. All respect `prefers-reduced-motion` and fall back to native scroll on touch.
- **Settings menu** (gear, top-right) — dark mode, accent swatch, and card style
  (Minimal / Data / Editorial). Persisted to `localStorage` under `jobs.ui.prefs`.

## Install

1. **Back up** your current `ui/src/` (e.g. `git switch -c ui-redesign`).
2. Copy the contents of this `ui/` folder over your repo's `ui/` folder, overwriting:
   - `index.html` (adds the Google Fonts link + new title)
   - `src/styles.css` (full new stylesheet)
   - `src/App.tsx`, `src/main.tsx`
   - `src/components/*` (Sidebar, JobCard, CardList, Segmented, bits, ResumeDiff)
   - `src/tabs/*` (ApplyQueue, HardRejections, SoftRejections, RunHistory, AppliedCalendar)
   - new: `src/theme.tsx`, `src/hooks.ts`, `src/utils.ts`, `src/icons.tsx`
3. `npm install` (no new deps were added) and `npm run dev`.

## Files you can delete after porting

- `src/components/DetailPanel.tsx` — replaced by the inline expand in `JobCard.tsx`.
- `src/components/Tabs.tsx` — replaced by the sidebar nav in `Sidebar.tsx`.

## Notes / assumptions

- Nav counts in the sidebar use your existing `Stats` fields
  (`pending`, `applied`, `hardRejectionsUnreviewed`, `softRejectionsUnreviewed`).
- The brand name/letter lives in one place: `BRAND` at the top of `src/components/Sidebar.tsx`.
- Keyboard shortcuts are preserved: `j`/`k` move focus, `Enter` expands, `Esc` collapses,
  `y`/`m`/`n`/`a` label the focused card (Apply Queue), `/` focuses search, `1`–`5` switch tabs.
- No backend, route, or API-shape changes are required.

## Type-check

All files were verified to compile (TS + JSX). Run your usual `tsc --noEmit` / `npm run build`
to confirm against your exact `tsconfig` — the code uses standard React 18 + TS and adds no
new dependencies.
