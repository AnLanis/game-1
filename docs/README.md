# Dusty Duty v2: documentation

Dusty Duty v2 is a from-scratch rewrite of the browser FPS in `google-game-test`. It is a deterministic 60 Hz simulation with procedural levels, real enemy AI and no external assets, presented through Three.js. These documents explain what was wrong with the original, what the rewrite changes and what it still leaves out.

## Reading order

| # | Document | Read it for |
|---|---|---|
| 01 | [Codebase review](01-codebase-review.md) | How the original works, its strengths, and a severity-ranked list of 22 issues with file and line references |
| 02 | [Market and video research](research/02-market-and-video-research.md) | Competitors, mobile references, AI-built shooters, portal requirements (Poki, CrazyGames), what players expect |
| 03 | [Design research](research/03-design-research.md) | Game feel, enemy AI, progression, level design, touch and accessibility, with starting values |
| 04 | [Tech research](research/04-tech-research.md) | Three.js, WebGPU, ECS, physics, navigation, multiplayer and delivery decisions, budgets |
| 05 | [Gap analysis](05-gap-analysis.md) | A 0 to 5 scoring matrix of the original, the v2 target and seven benchmarks across 20 dimensions, then gap, evidence, v2 response and remaining gap for each |
| 06 | [Architecture](06-architecture.md) | Layers, folder map, key abstractions, tick order, determinism rules, why a heightfield, the WebGPU gate, budgets, how to extend, the multiplayer path |
| 07 | [Roadmap](07-roadmap.md) | v2.0 ship gate, v2.1 polish, content cadence, v3 multiplayer, portal launch plan with KPIs, risks |

## Quick answers

- **Why rewrite?** The original cannot boot on its own Pages URL, cannot be played on a phone, and its AI, hit model and content structure cannot be extended cheaply. See the review's C1, C2 and H1 to H6.
- **What is the core idea?** The game is a pure function of a mission config and a stream of `InputCmd`s. See [architecture §1](06-architecture.md).
- **What is done?** The simulation, procedural generation, content data, device input, settings model and audio synthesis toolkit are in `src/`. The renderer, UI, app shell, progression and portal adapter were still being implemented when these documents were written. The [roadmap](07-roadmap.md) lists the gate for shipping.

## Conventions

- **Built** means present in `src/` when written. **(being implemented)** means the folder was empty or partial.
- Scores in the gap analysis for v2 are targets, not measurements. Benchmark scores are estimates from the research, which did not include playing the games.
- Figures marked *(lead)* in the review were measured by the project lead; timings in the architecture doc were measured in Node on the authoring container, not on a phone.
