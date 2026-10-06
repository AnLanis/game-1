# Gap analysis: original vs v2 vs the field

This compares the [original game](01-codebase-review.md), the v2 design, and seven benchmarks across 20 dimensions. Market and design facts come from the three research notes: [market and video](research/02-market-and-video-research.md), [design](research/03-design-research.md) and [tech](research/04-tech-research.md). The v2 design is in [06-architecture.md](06-architecture.md) and the schedule is in [07-roadmap.md](07-roadmap.md).

## How to read the scores

Scale: 0 = absent or broken, 1 = poor, 2 = weak, 3 = adequate, 4 = strong, 5 = best in class.

| Column | Basis |
|---|---|
| Original | Measured from its code (see the codebase review). |
| v2 target | What v2.0 commits to on shipping. **Not a measurement.** Rows marked † depend on layers that were still being implemented when this was written (`render/`, `ui/`, `app/`, `platform/`, most of `meta/`, the audio mixer). Rows without † rest on code already in `src/` (engine, content, sim, procgen, input, audio DSP). |
| Benchmarks | Analyst estimates from the market research, which relied on search-result summaries. No benchmark game was played for this analysis. A trailing `?` means there was little or no evidence for that cell. `-` means no public evidence (for example, test practices of closed-source games). |

The averages at the bottom cover only scored rows, so they compare a game with itself over time better than one game with another.

## Scoring matrix

| # | Dimension | Original | v2 target | Krunker | Venge | Shell Shockers | Deadshot | BodyCamera | CoD Mobile | Claude of Duty |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | Load time and size † | 1 | 5 | 4 | 5? | 4 | 4? | 1 | 1 | 3? |
| 2 | Mobile and touch † | 0 | 4 | 2? | 2? | 3 | 2? | 0 | 5 | 0 |
| 3 | Core gun feel † | 2 | 4 | 5 | 3 | 2 | 4 | 4 | 5 | 3? |
| 4 | Movement | 1 | 3 | 5 | 3? | 2 | 5 | 2? | 3 | 2? |
| 5 | Opposition quality (AI or players) | 1 | 4 | 4 | 3 | 4 | 4 | 3? | 4 | 3? |
| 6 | Level variety and replayability | 1 | 4 | 5 | 3 | 3 | 3 | 2? | 5 | 1 |
| 7 | Progression and retention † | 1 | 4 | 5 | 4 | 3 | 3? | 2? | 5 | 0 |
| 8 | Modes | 1 | 4 | 5 | 4 | 3 | 4 | 2 | 5 | 0 |
| 9 | Audio † | 1 | 4 | 3? | 3? | 3? | 3? | 4? | 5 | 4 |
| 10 | Visuals † | 3 | 3 | 3 | 3 | 3 | 3 | 5 | 5 | 4 |
| 11 | Performance scaling † | 1 | 4 | 4 | 5? | 4 | 4? | 1 | 4 | 2 |
| 12 | Accessibility † | 1 | 4 | 3? | 2? | 2? | 3? | 2? | 4 | 0 |
| 13 | Portal readiness † | 0 | 4 | 4 | 5 | 4 | 4 | 3 | 0 | 0 |
| 14 | Monetization hooks † | 0 | 2 | 5 | 4 | 5 | 3? | 3 | 5 | 0 |
| 15 | Shareability and virality † | 0 | 3 | 4 | 2? | 3 | 2? | 3? | 4 | 5 |
| 16 | Content pipeline | 1 | 4 | 5 | - | 4 | - | - | 5 | - |
| 17 | Testing and QA | 1 | 4 | - | - | - | - | - | - | - |
| 18 | Architecture scalability | 1 | 4 | - | - | - | - | - | - | - |
| 19 | Multiplayer readiness | 0 | 3 | 5 | 5 | 5 | 5 | 0 | 5 | 0 |
| 20 | Stability and integrity | 1 | 4 | 3 | 4? | 3 | 3? | 4? | 4 | - |
| | **Average of scored rows** | **0.9** | **3.8** | **4.1** | **3.5** | **3.3** | **3.5** | **2.4** | **4.1** | **1.7** |

Reading the matrix:

- The original is at or below every benchmark on nearly every row. Its only 3 is visuals. Its zeros are things it cannot do at all: mobile play, portal launch, sharing, multiplayer.
- v2 aims to match the single-player and browser-native benchmarks on structure (modes, replayability, pipeline, portal fit) while accepting lower scores than Krunker or CoD Mobile on movement depth, visuals and monetization. It deliberately does not compete on multiplayer or realism.
- Claude of Duty scores high on visuals, audio and virality and near zero on everything a player returns for. That is the market note's main warning: a demo gets attention once.

## Dimension notes

Each note follows the same order: the gap, the evidence, what v2 does, and what remains. "Built" means present in `src/` when this was written.

### 1. Load time and size †
- **Gap.** The original loads 3.4 MB of GLBs plus a 777 KB chunk through 16 serial requests, boots in 27.7 s under SwiftShader, and does not boot at all on its Pages URL (codebase review C1, H3).
- **Evidence.** Poki wants under 8 MB initial. CrazyGames wants 20 MB or less for the mobile homepage and under 10 s load for top games ([market §4](research/02-market-and-video-research.md)). Claude of Duty shows a zero-asset game is feasible ([market §3](research/02-market-and-video-research.md)). Minimal Three.js WebGL is about 138 KB gzipped ([tech](research/04-tech-research.md)).
- **v2.** No external assets. Meshes, textures and audio are generated. `vite.config.ts` uses `base: './'` and splits Three.js into its own chunk (built). Target: under 400 KB gzipped in total (planned, not yet measured).
- **Remaining.** Generation moves cost from download to CPU. Time to interactive on a low-end phone is unmeasured. The pre-rendered sound bank is the likeliest boot cost and may need lazy or worker rendering.

### 2. Mobile and touch †
- **Gap.** The original cannot turn or fire on touch (codebase review C2).
- **Evidence.** CrazyGames requires touch if mobile is claimed, and desktop-only games lose the mobile homepage. BodyCamera Shooter is desktop-only ([market §4, §7](research/02-market-and-video-research.md)). The design note specifies a floating stick on the left 45%, a look drag on the right, buttons of at least 48 px, `pointerId` tracking, and friction, magnetism and rotational-follow aim assist ([design §5](research/03-design-research.md)).
- **v2.** `input/touch.ts` (built): floating move stick (left 45%), look zone (right 55%), fire, ADS toggle, jump, crouch toggle, reload, grenade, swap, interact, pause; Pointer Events by `pointerId`; safe-area insets. `input/Input.ts` (built) adds gamepad, optional auto-fire, and friction plus magnetism aim assist for touch and gamepad only, never mouse. `DifficultyDef.aimAssist` holds a per-difficulty strength from 1.0 (recruit) to 0.4 (dust).
- **Remaining.** Nothing has run on a real device. No gyro aim, no rotational-follow assist, no HUD layout editor (CoD Mobile has one). iOS audio unlock and fullscreen quirks are untested.

### 3. Core gun feel †
- **Gap.** The original's recoil is cosmetic, shots start at the muzzle, the viewmodel fills a quarter of the screen, and audio is six oscillator beeps (M3, M7).
- **Evidence.** The design note separates aim kick, visual camera spring and viewmodel spring, and asks for trauma-based shake, victim-only hit-stop, three hit-marker states and layered gun audio ([design §1](research/03-design-research.md)).
- **v2.** In the sim (built): shots trace from the eye. Each weapon has a deterministic recoil pattern with 25% jitter, pitch and yaw caps, recovery, a 0.45 s pattern reset, bloom, and spread that grows with movement and airtime and shrinks with ADS and crouch. Damage falls off with range. Headshot and limb multipliers, `whiz` near-miss events and a `hitStop` field exist. 10 player weapons and 9 attachments. `WeaponDef.recoil.punch` carries the view-punch ratio for the renderer (viewmodel pass, camera trauma and hit markers are planned).
- **Remaining.** No player has tuned any of it. Time-to-kill values are design targets, not playtest results.

### 4. Movement
- **Gap.** Walk and sprint at a fixed eye height.
- **Evidence.** Slide, lean and mantle are now expected; Deadshot's identity is slide, air-strafe and shotgun-jump ([market §1, §5](research/02-market-and-video-research.md)).
- **v2.** Built in `sim/movement.ts`: jump, crouch, slide (10.5 m/s for 0.75 s from a sprint), auto step-up of 0.45 m (which doubles as mantling low cover), air control, per-biome gravity (Red Dust at 0.4 g) and a low-gravity modifier.
- **Remaining.** No air-strafe or bunny-hop tech, no lean, no vault animation. The 1 m grid limits stairs and ramps to step-ups.

### 5. Opposition quality
- **Gap.** Beeline AI, dice-roll hits, permanent aggro, no cover (H1, H2).
- **Evidence.** The design note draws on F.E.A.R. (few states plus squad behaviours and barks), Doom 2016 attack tokens, Splinter Cell awareness meters, the Left 4 Dead director, grace shots and per-difficulty reaction and aim error ([design §2](research/03-design-research.md)).
- **v2.** Built. A* with corner-cut prevention and string-pulling, a shared flow field for rushers, and precomputed cover points (`sim/nav.ts`). Brains (`sim/ai/brain.ts`): sight cones with an awareness meter that reacts to distance, stance and sprinting; hearing with radii by weapon loudness; delayed squad alerts; cover and peek; one flanker per squad; rush and strafe; a 0.85 s marksman laser telegraph; grenades against players who camp more than 2.5 s; morale and panic; barks. Director (`sim/ai/director.ts`): attack tokens (2 to 5 by difficulty), one shared grenade cooldown, 8 path queries per tick, out-of-sight reinforcements, Last Stand waves. Enemy bullets are real traces with aim error and 1 to 3 grace shots. 7 enemy types, 4 factions.
- **Remaining.** No melee, doors or vertical play. No adaptive difficulty rank. Nobody has judged whether it is fun. Sim tail latency needs profiling (see 11).

### 6. Level variety and replayability
- **Gap.** Three hand-placed maps, about 9 minutes in total (H5).
- **Evidence.** Playtime is the main risk for portal metrics ([market §7](research/02-market-and-video-research.md)). Design pattern: generate the mission graph first, validate connectivity, hand-shaped rooms joined by procedural links ([design §4](research/03-design-research.md)).
- **v2.** Built. 6 biomes on 6 layout generators. `(biome, seed)` maps to one level. `ensureConnected` repairs unreachable pockets. `planMission` places objectives by path distance from spawn and spends a per-op threat budget on squads, with no heavies or marksmen in the first 35% of the path and no squads within 22 m of spawn (the fix for H4). 12 campaign ops, a Daily Op, Contracts (biome × 6 contract types × seed code) and Last Stand.
- **Remaining.** Tests check connectivity and determinism. Nothing validates sightline length, cover spacing or power positions, which the design note recommends. Visual variety comes from palettes and prop sets, not new geometry. No multi-floor interiors.

### 7. Progression and retention †
- **Gap.** Star-gated unlocks only.
- **Evidence.** Mobile D1 median is about 22% and the top 10% reach about 40%. Dailies and streaks drive D1 and D3; weapon levels and mastery drive D7 ([design §3](research/03-design-research.md)). CrazyGames wants D1 of 10 to 15% ([market §4](research/02-market-and-video-research.md)).
- **v2.** Built in the sim and content: score, XP and 15 medals, weapon `unlockLevel`, attachment mastery levels, 7 perks, 9 modifiers (5 warnings that add XP, 4 anomalies). Planned in `meta/`: levels, mastery, daily challenges, streaks, and migration of the v1 save.
- **Remaining.** No seasons, no cosmetics track, no server leaderboards (records are local). No evidence yet that any of it moves D1 above 15%.

### 8. Modes
- **Gap.** One mission shape: eliminate, plus a secondary.
- **v2.** Built. 8 objective kinds (eliminate, hold with waves, sabotage, intel, rescue and escort, HVT that flees, extract, survive), 4 modes (campaign, daily, contract, last stand), 4 difficulties. The sim never reads the mode; modes are different `MissionConfig` producers.
- **Remaining.** No PvP, co-op, ranked, weekly Deep Op or ghost replays, which the design note suggests ([design §3](research/03-design-research.md)).

### 9. Audio †
- **Gap.** The original synthesises six oscillator beeps with no spatialisation.
- **Evidence.** Five-layer guns, per-environment tails, ±4% pitch variation, a compressor and a voice cap ([design §1](research/03-design-research.md)). 16 voices on mobile, 32 on desktop, HRTF only for the nearest sounds ([tech](research/04-tech-research.md)). Claude of Duty's launch told viewers to turn the sound on ([market §6](research/02-market-and-video-research.md)).
- **v2.** Built: `audio/dsp.ts` renders sounds offline to `Float32Array`s from seeded generators, so the bank is identical on every machine and testable in Node. `audio/sfxdefs.ts` defines 45 sound ids with voice-steal priority, variants, rate limits, reverb sends, distance delay and cull range. The mixer (buses, compressor, panner) is planned.
- **Remaining.** No recorded samples and no proper music. Barks are captions, not voice. Synthesis quality against recorded audio is unproven. Render cost on phones is unmeasured.

### 10. Visuals †
- **Gap.** The original looks decent but depends on 3.4 MB of third-party GLBs.
- **Evidence.** AI-built shooters look amateur up close, with mannequin-like enemies ([market §3](research/02-market-and-video-research.md)). BodyCamera Shooter scores 9.4/10 on realism we will not match.
- **v2.** Stylised, not realistic: per-biome palettes, instanced procedural characters with faction and headgear variants, a merged static world, post FX, a Mars sky. Only `render/util.ts` existed when this was written.
- **Remaining.** Procedural animation will not match skinned GLB quality. No cascaded shadows or GTAO. This row stays at 3 because the risk is real.

### 11. Performance scaling †
- **Gap.** One fixed configuration, whole-scene raycasts, no tiers (M2).
- **Evidence.** Poki wants 30 fps minimum and 60 target on mid-range mobile. Budgets: at most 120 draw calls on mobile ([market §4](research/02-market-and-video-research.md), [tech](research/04-tech-research.md)).
- **v2.** Sim (built, measured in Node on this container): 0.09 to 0.42 ms average per 60 Hz tick across 3-minute Last Stand runs on all 6 biomes, with 12 to 16 hostiles alive at peak; level generation plus mission planning 2 to 23 ms. Raycasts are exact grid walks. Brains think at 10 Hz, staggered. Rendering (planned): merged world, instancing, quality tiers, dynamic resolution.
- **Remaining.** The 60-enemy budget is unmeasured (runs peaked at 16). The tail is heavier than the mean: p99 was 1.75 to 10 ms and the worst tick 66 ms, so tail spikes from A*, flow-field rebuilds or GC need profiling. No GPU numbers from a real phone.

### 12. Accessibility †
- **Gap.** Fixed sensitivity, FOV and volume; no remapping.
- **Evidence.** Most-cited issues are remapping, text size, colour vision and subtitles. FOV mismatch causes motion sickness ([design §6](research/03-design-research.md)).
- **v2.** Built: `input/Input.ts` supports remapping by `KeyboardEvent.code`, hold or toggle for ADS and crouch, invert Y, and separate ADS, touch and gamepad sensitivities. `meta/settings.ts` covers FOV 65 to 110, quality tiers, render scale, a reduced-motion master switch, shake and head-bob sliders, hit-marker and damage-number toggles, colourblind modes, high-contrast enemies, subtitles, HUD scale, crosshair style and colour, and per-bus volumes. The sim emits barks as data with faction callsigns for captions. UI to expose all of this is planned.
- **Remaining.** No screen-reader-friendly menus, no one-handed or switch schemes, no text-to-speech.

### 13. Portal readiness †
- **Gap.** The original does not boot when hosted at a sub-path, weighs 6.4 MB of assets, has no touch, and has no ad or session hooks.
- **Evidence.** Poki: `gameplayStart()` on first input, ads only between sessions, `rewardedBreak()` for opt-in rewards, no external links. CrazyGames: gameplay within one click, controls overlay, 10+ minute playtime, 80%+ conversion, D1 of 10 to 15% ([market §4](research/02-market-and-video-research.md)).
- **v2.** Relative base and no fetched assets (built). A portal adapter for Poki and CrazyGames (planned) will wrap gameplay start and stop, commercial breaks, rewarded breaks and pause-on-ad.
- **Remaining.** Not submitted anywhere. The adapters have not run against the real SDKs. Portals hand-pick games, so acceptance is not ours to decide. English only.

### 14. Monetization hooks †
- **Gap.** None.
- **Evidence.** Shell Shockers earns 80 to 90% from ads. Rewarded video pays about twice an interstitial (unverified). Players expect cosmetic-only monetization ([market §1, §4, §5](research/02-market-and-video-research.md)).
- **v2.** Rewarded revive or ammo and a break between missions through the portal adapter (planned). Weapon `ViewModelSpec` colours are the future camo hook.
- **Remaining.** No store, currency, cosmetics or premium tier, and no analytics. That is a choice for v2.0, not an oversight.

### 15. Shareability and virality †
- **Gap.** Nothing to share.
- **Evidence.** Shareable clips show multi-kills and readable results. A Wordle-style daily is recommended. Claude of Duty's launch drew 3.8M views on a "one prompt, zero assets" story ([market §3, §6, §7](research/02-market-and-video-research.md)).
- **v2.** Built: a UTC-date seed gives everyone the same Daily Op (`dailySeed`, `dailyInfo`), 6-character seed codes, 15 medals. The share string and result screen are planned.
- **Remaining.** No clip or GIF export, no input recorder or replay viewer (the sim can replay but nothing records `InputCmd` streams yet), no leaderboards.

### 16. Content pipeline
- **Gap.** A new mission means editing four files by hand.
- **v2.** Built: every weapon, enemy, biome, perk, modifier, difficulty and campaign op is data in a validated `Registry`. Cross-references are checked when the module loads, so a typo fails at boot or in unit tests. Layouts are generators keyed by `(biome, seed)`.
- **Remaining.** Content is TypeScript, not loadable JSON. There is no editor, remote config or localisation pipeline. Objective kinds and layout styles are code, not registries.

### 17. Testing and QA
- **Gap.** One smoke test, and deploy runs no tests (H6).
- **v2.** Built: Vitest in a Node environment covers RNG, math, grid raycasts, navigation, registries and procgen validity across biomes and seeds. A helper drives a full mission with the `PlayerBot`. An ad hoc check in this container produced identical `hash()` sequences across two runs of three campaign ops and a Last Stand, and different hashes for a different seed. Playwright bot playtests and a deploy gate are planned.
- **Remaining.** Three procgen tests were failing while the code was in flux. There is no permanent determinism test, no visual baselines and no performance gate.

### 18. Architecture scalability
- **Gap.** A 937-line `Game.ts` couples simulation, rendering and UI (M1).
- **v2.** Built: a pure, headless, fixed-step simulation behind a small API; data-driven content; a layered folder structure. See [06-architecture.md](06-architecture.md).
- **Remaining.** The heightfield allows one height per 1 m cell: no overhangs, bridges or upper floors. `sim/world.ts` is 873 lines and growing. Layering is convention and Node-run tests, not a lint rule.

### 19. Multiplayer readiness
- **Gap.** None; state lives in scene objects.
- **Evidence.** Server-authoritative ticks, input commands with sequence numbers, snapshot interpolation and lag-compensated hitscan ([tech](research/04-tech-research.md)). Cheating is the top complaint about multiplayer browser shooters, and Kour.io's client-side trust led to exploits and a rapid decline ([market §1, §5](research/02-market-and-video-research.md)).
- **v2.** Built: the sim is headless, every actor (player and AI) is driven by an `InputCmd`, actors keep previous-tick state for interpolation, the sim emits events as data, `hash()` detects desync, `snapshot()` gives a compact actor view, and RNG state can be read and set.
- **Remaining.** The world takes one player command and assumes one player in 36 places across 6 files. There is no full-state save and restore, no hitbox history for lag compensation, no wire format and no transport.

### 20. Stability and integrity
- **Gap.** C1 boot failure, nondeterminism (M5), no useful error path.
- **v2.** Built: no fetched assets removes the class of failure behind C1; registries fail fast; the sim has no `Math.random`, wall clock or DOM access (checked by search); score and medals live in the sim, so results can be replay-verified.
- **Remaining.** No replay verifier exists, so leaderboard integrity is unproven. WebGL context loss and `localStorage` failures need handling in the app layer (planned).

## What v2 still does not do

In priority order for the portal launch (see [07-roadmap.md](07-roadmap.md)):

1. **Run on a real phone.** Touch play, aim-assist tuning, thermals and iOS quirks are all unverified.
2. **Prove the game is fun.** Gun feel, time-to-kill and AI difficulty need playtests. Add bot-driven balance runs across many seeds.
3. **Measure the KPIs.** No analytics, so D1, playtime and conversion cannot be tracked.
4. **Give players a reason to return.** Seasons, cosmetics and server-side daily leaderboards are absent; the local progression meta is still being built.
5. **Validate generated levels for fun, not just validity.** Sightline, cover spacing and pacing checks.
6. **Multiplayer.** Co-op first; needs multi-player sim support, full-state serialisation and lag compensation.
7. **Vertical space.** Multi-floor buildings, ramps and rooftops need a change to the level representation.
8. **Replays and clip export.** Needed for sharing and for verifying leaderboard scores.
9. **Content tooling.** JSON content packs, an editor, remote config, localisation.
10. **WebGPU.** Deferred behind a device gate.
11. **Recorded or composed audio.** Voice barks and real music.
