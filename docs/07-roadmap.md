# Roadmap

Phases run in order, but v2.x content drops and the v3 groundwork can overlap. Durations are rough estimates for planning, not commitments. The reasoning behind each phase is in the [gap analysis](05-gap-analysis.md); the technical design is in the [architecture](06-architecture.md).

## Now: v2.0 (in progress)

**Already in `src/` (checked by reading the code):**

| Area | State |
|---|---|
| Simulation | Deterministic 60 Hz step, one `InputCmd` for players and AI, `hash()` and `snapshot()`, event stream |
| Level geometry | Heightfield grid with exact raycast, line of sight, A*, flow field and cover points |
| AI | Brains (sight, hearing, cover, flank, rush, grenades, morale, barks) and a Director (tokens, grenade cooldown, path budget, waves, Last Stand) |
| Content | 10 player weapons and 9 attachments, 7 enemies, 4 factions, 6 biomes (including Red Dust at 0.4 g), 4 difficulties, 7 perks, 9 modifiers |
| Generation | 6 layout generators with connectivity repair, mission planner, 12 campaign ops in 3 chapters, Daily Op, Contracts, Last Stand |
| Objectives and scoring | 8 objective kinds; score, XP and 15 medals inside the sim |
| Devices | Keyboard and mouse, gamepad, touch (floating stick, look zone, buttons), aim assist, remapping |
| Settings model | FOV, quality, reduced motion, colourblind, subtitles, HUD scale, volumes |
| Audio | Offline synthesis toolkit and 45 sound definitions |
| Tests | Vitest for grid, nav, RNG, registries, procgen; a bot runner for full-mission headless play |

**Still to land before v2.0 ships** (folders empty or partial when this was written): the renderer (world meshing, instanced characters, viewmodels, post FX, quality tiers, dynamic resolution), UI (menus, HUD, settings, results and share screen), the app state machine, progression and saves with v1 migration, the audio mixer, the portal adapter, Playwright bot playtests and a CI gate on deploy.

**v2.0 ship gate.** All must hold:

1. The built site boots from a sub-path (as on GitHub Pages) in CI, and a bot playtest passes against that build. This is the check the original never had.
2. A mission is completed on a real phone using touch.
3. Every campaign op, the Daily Op, a Contract and Last Stand finish under the bot in CI.
4. Total download is under 400 KB gzipped and the menu is interactive in under 5 s on throttled 4G and a mid-range phone.
5. Frame time holds the budget on the lowest quality tier on that phone.
6. A permanent determinism test (same seed and commands, same `hash()` sequence) is in `tests/unit`.

## v2.1: polish (about 4 to 6 weeks after v2.0)

- **Tune from real play.** Time-to-kill, recoil, AI reaction and aim error, ammo economy. All values are data in `content/`.
- **Gun feel pass.** Viewmodel pass, camera trauma, victim-only hit-stop, three hit-marker states, muzzle-flash light.
- **Sim tail latency.** Bring p99 tick time under 2 ms on mobile-class hardware and measure with 60 enemies. Today's Node runs show p99 up to 10 ms and a 66 ms worst tick.
- **Analytics.** First-input time, mission start and end, session length, D1 cohorts. Without it the KPIs below cannot be tracked.
- **Onboarding in gameplay.** The first mission teaches controls; a controls overlay is always reachable (a portal requirement).
- **Procgen validators.** Sightline length, cover spacing and pacing checks, plus bot balance sweeps across many seeds that flag unwinnable or trivial maps.
- **Replays.** Record `InputCmd` streams, add a viewer, verify with `hash()`, and produce the share string.
- **Accessibility pass.** Menu navigation by keyboard and gamepad, caption styling, colourblind checks.

## v2.x: content cadence

Target rhythm, adjustable to team size: one drop per month.

- One new biome or layout, one or two weapons, one enemy or modifier, and two or three campaign ops.
- A weekly Deep Op (three linked stages) and rotating weekly modifiers.
- Camo unlocks from weapon mastery, using the finish colours already in each weapon's model spec.
- Each drop is registry data plus tests. Changing an existing generator bumps `GENERATOR_VERSION`, so older generator versions must stay available for old seed codes and past Daily Ops.
- Server-side daily leaderboards only after replays exist and can be verified.

## v3: multiplayer

1. Make `SimWorld` multi-player: `step` takes commands per actor, with per-player state, scoring and loadouts. About 36 single-player references in 6 files.
2. Full-state serialise and restore, tested as snapshot, restore, identical `hash()`.
3. Node server running the same `SimWorld` at 60 Hz with WebSocket transport (WebTransport later).
4. Client prediction and reconciliation, snapshot interpolation about 100 ms behind, hitscan lag compensation up to 200 ms.
5. Co-op Last Stand for 2 to 4 players first, since AI stays server-side. PvP later, because cheating is the top complaint about multiplayer browser shooters.
6. Invite links and rooms, no accounts.

Exit criteria: 4 players stable at a 60 Hz server tick within 20 KB/s down and 5 KB/s up per client (budgets from the [tech research](research/04-tech-research.md)).

## Portal launch plan

1. **Pass the v2.0 gate.**
2. **Soft launch** on a self-hosted URL with 20 to 50 testers. Watch the KPIs and fix load, controls and onboarding first.
3. **Submit to CrazyGames** (mobile homepage needs 20 MB or less; we are far under) and **Poki** (under 8 MB initial, hand-picked). Both need the adapter to call gameplay start on the first input, use commercial breaks only between missions, and use rewarded breaks only when the player opts in. Neither allows external links.
4. **Iterate on portal metrics** until the KPIs hold.

| KPI | Target | Reference | Main levers |
|---|---|---|---|
| Load to interactive menu | under 5 s | CrazyGames top games load in under 10 s | Zero assets, chunk split, lazy audio rendering |
| Conversion (plays 1+ minute) | 80% or more | CrazyGames top games | One-click play, onboarding in gameplay |
| Average playtime | 10 minutes or more | CrazyGames successful games | Daily Op, Contracts, Last Stand, progression |
| D1 retention | 15% or more | CrazyGames 10 to 15%; mobile median about 22% ([design §3](research/03-design-research.md)) | Daily Op, streaks, unlocks |
| Frame rate | 30 fps minimum, 60 target | Poki, mid-range mobile | Quality tiers, dynamic resolution |

Proposed decision rules after about 1,000 sessions: conversion under 60% means fix load and onboarding before anything else; playtime under 6 minutes means push Last Stand and Contracts harder in the menu; D1 under 10% means strengthen dailies and streaks. Monetization stays limited to opt-in rewarded ads (revive, resupply) and between-mission breaks; nothing interrupts play, and nothing is pay-to-win.

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Presentation layers land late or integrate badly | v2.0 slips | The ship gate above; bot playtest on every build |
| Procedural art reads as amateur up close ([market §3](research/02-market-and-video-research.md)) | Weak first impression, low conversion | Stylised palette-driven direction, outside eyes early, no realism goal |
| Gun feel or AI is not fun | Low playtime and D1 | v2.1 tuning; balance values live in data; playtests before portal submission |
| Boot cost of generated audio and meshes on phones | Misses the 5 s load target | Measure early; render audio lazily or in a worker |
| Sim tail spikes | Hitches on low-end devices | Profile A*, flow-field rebuilds and GC; spread work across ticks |
| Touch aiming is unproven | Mobile is the main reach | Real-device testing from the first build; tune aim assist |
| Portal acceptance is not guaranteed | No distribution | Target both portals, keep a self-hosted build |
| Retention needs more than local progression | D1 under target | Dailies and streaks first; server leaderboards later |
| Replays recorded in one browser engine may not verify in another (`sin`, `cos`, `atan2` differ across engines) | Leaderboard rejections | Verify with the same engine family, or record the engine and compare tolerantly; do not ship leaderboards before testing across browsers |
| Generator changes break shared seeds | Broken links, Daily Op mismatch | Versioned generators; a test that pins known seeds |
| Multiplayer needs a core refactor | v3 cost | Keep the refactor in v3 and avoid new single-player assumptions in the meantime |
