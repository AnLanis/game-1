# Tech research: building a scalable Three.js FPS (2026)

Research date: 2026-09-30.
- Versions were checked with `npm view`.
- Bundle sizes were measured locally: esbuild minify, then gzip -9.
- Some documentation sites were blocked by the research sandbox. Claims taken from search summaries are flagged.

## Summary

| Area | State in 2026 | Decision for Dusty Duty v2 |
|---|---|---|
| **three.js** | 0.186.1 is current (r186, Sep 2026). The original game uses r184. | Upgrade to **0.186.1**. |
| **WebGPURenderer** | The three.js manual calls it "still in an experimental state". WebGLRenderer "is still maintained and the recommended choice for pure WebGL 2 applications", but new features land on the WebGPU/TSL side. `three/webgpu` falls back to WebGL2 automatically. Costs: about +110 KB gz, and about 2× the CPU per object in a forum benchmark (r183). | **WebGLRenderer behind a renderer boundary** for v2. It is universal, works in headless CI, and fits the stylized art direction. WebGPU is a roadmap item with a device gate: ≤150 draw calls and a stable 60 fps at render scale ≥0.75 on a low-end Android phone and on iOS 18/26. See the [architecture doc](../06-architecture.md). |
| **Shadows** | `PCFSoftShadowMap` is deprecated; `PCFShadowMap` is now soft. `SunLight` (cascaded shadows) arrived in r186. | A single sun with `PCFShadowMap`, and the shadow camera follows the player. Evaluate cascaded shadows at the WebGPU gate. |
| **Draw calls** | InstancedMesh and BatchedMesh are the main levers. Budget: ≤100–150 draw calls on mobile. | The static world is merged into about 10 material batches. Characters and particles are instanced. The target is under 60 draw calls. |
| **ECS** | bitECS 0.4 (MPL-2.0, ~4.6 KB gz, has built-in serializers). koota 0.6 (no serialization). miniplex and becsy are stale. | A **custom data-oriented sim**: plain typed structs with stable numeric IDs, plus `snapshot()` and `hash()`. At our entity counts (under 500) ECS throughput is not the bottleneck. The sim is hidden behind `SimWorld`, so bitECS can be swapped in later. |
| **Fixed timestep** | 60 Hz accumulator with capped substeps and interpolation alpha. | Adopted (`engine/loop.ts`). |
| **Determinism** | Arithmetic is exact IEEE-754. `Math.sin`/`cos`/`atan2` may differ between browsers. | Seeded sfc32 streams. No `Math.random` or `Date.now` in the sim. Replays are exact on the same build and browser. Server-authoritative netcode does not need bit-exactness. |
| **Physics** | Rapier 0.21 is 1.17 MB gz of WASM. Jolt is 742 KB gz. three-mesh-bvh is 16 KB gz. | **None needed.** Levels are a 2.5D heightfield grid, so raycasts and collision are exact DDA walks costing O(cells crossed), which is cheaper than a BVH. Rapier can be lazy-loaded later for ragdolls or physics props. |
| **Navigation** | recast-navigation-js is 131 KB gz of WASM. navcat is 35 KB gz of pure TypeScript. Flow fields suit crowds. | Grid A\* with string-pulling for tactical moves, plus a **flow field** from the player's cell for horde rushers. navcat becomes relevant only if levels gain multiple floors. |
| **Multiplayer** | WebTransport reached Baseline in 2026 (Safari 26.4, via search summaries). Colyseus 0.18 ships client prediction and lag compensation (search summaries). | **Build the abstractions now, defer servers.** AI bots and the player drive actors through the same `InputCmd`. The sim is pure and headless. The sim can produce a full snapshot and a hash, and emits events as data. |
| **Audio** | HRTF costs about 10× equalpower. Budget 16 voices on mobile and 32 on desktop. ZzFX is about 1 KB. | A custom `AudioEngine`: buses, compressor, voice pool with stealing, equalpower panning, HRTF only for the nearest sounds, and procedural synthesis pre-rendered to buffers. |
| **Delivery** | Poki: initial download under 8 MB (secondary source). CrazyGames: under 20 MB to qualify for the mobile homepage. GitHub Pages cannot set COOP/COEP headers, so SharedArrayBuffer is unavailable. | **Zero external assets.** Target under 400 KB gz total. `base: './'` so the build runs on any host. |
| **Testing** | Playwright plus SwiftShader (the `--enable-unsafe-swiftshader` opt-in is now required). Headless sim tests in Vitest. | Vitest runs the sim, procgen, nav and determinism tests with no WebGL. Playwright runs boot, render and bot-playtest checks. |

## Performance budgets we adopted

| Metric | Mobile | Desktop |
|---|---|---|
| Draw calls, including shadow pass | ≤ 120 | ≤ 250 |
| Triangles | ≤ 250k | ≤ 1M |
| Pixel ratio cap | 1.5 | 2.0 |
| Shadow map | 1024² or off | 2048² |
| Sim tick cost (60 enemies) | ≤ 2 ms | ≤ 1 ms |

**Adaptive quality.** An exponential moving average (EMA) tracks frame time.
- More than 2 s over budget: render scale drops by 0.1, down to a floor of 0.5.
- More than 5 s comfortably under budget: render scale rises again.
- Quality tiers switch shadows, bloom, MSAA and particle counts.

## Multiplayer pattern (for the roadmap)

The Source/Gambetta approach:
- **Server:** authoritative, 30–60 Hz tick. Sends snapshots at 20–30 Hz, delta-compressed.
- **Client input:** sends input commands tagged with a sequence number, plus the last 2–3 commands for redundancy.
- **Own player:** client-side prediction and reconciliation.
- **Remote players:** rendered by snapshot interpolation about 100 ms behind.
- **Hitscan:** lag-compensated by rewinding a ring buffer of hitboxes up to 200 ms.
- **Bandwidth target:** ≤20 KB/s down and ≤5 KB/s up per client.

## Libraries considered

| Library | Version | Size | License | Verdict |
|---|---|---|---|---|
| three | 0.186.1 | 138 KB gz (minimal WebGL) | MIT | **Adopt** |
| bitecs | 0.4.0 | ~4.6 KB gz | MPL-2.0 | Option. Revisit if entity counts go above ~2k. |
| koota | 0.6.6 | ~11 KB gz | ISC | Alternative |
| three-mesh-bvh | 0.9.15 | ~16 KB gz | MIT | Not needed: the heightfield grid gives exact raycasts |
| @dimforge/rapier3d | 0.21.0 | 1.17 MB gz | Apache-2.0 | Defer |
| navcat | 0.4.1 | ~35 KB gz | MIT | Defer until levels have multiple floors |
| colyseus / partyserver | 0.18.8 / 0.5.10 | — | MIT / ISC | Multiplayer-phase candidates |
| zzfx | 1.3.2 | ~1 KB gz | MIT | Pattern reference. We synthesize our own. |
| vite | 8.3.1 | — | MIT | **Adopt** |
| vitest | 5.0.2 | — | MIT | **Adopt** |
| @playwright/test | 1.60+ | — | Apache-2.0 | **Adopt** |

## Sources

- three.js releases [r186](https://github.com/mrdoob/three.js/releases/tag/r186), [r185](https://github.com/mrdoob/three.js/releases/tag/r185), [Migration guide](https://github.com/mrdoob/three.js/wiki/Migration-Guide), and the WebGPURenderer manual ([raw source](https://raw.githubusercontent.com/mrdoob/three.js/dev/manual/pages/webgpurenderer.html))
- [gpuweb implementation status](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status)
- [Forum: WebGPURenderer CPU overhead (r183)](https://discourse.threejs.org/t/webgpurenderer-2x-slower-cpu-and-5-10x-slower-first-frame-than-webglrenderer-on-many-mesh-scenes-r183-same-on-both-backends/91904)
- [bitECS](https://github.com/NateTheGreatt/bitECS) · [koota](https://github.com/pmndrs/koota) · [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) · [navcat](https://github.com/isaac-mason/navcat) · [recast-navigation-js](https://github.com/isaac-mason/recast-navigation-js) · [Rapier](https://github.com/dimforge/rapier/tree/master/typescript)
- [Colyseus 0.18](https://colyseus.io/blog/colyseus-018-is-here/) · [PartyKit](https://docs.partykit.io/how-partykit-works/) · [WebKit Safari 26.4](https://webkit.org/blog/17862/webkit-features-for-safari-26-4/)
- [Valve: Source multiplayer networking](https://developer.valvesoftware.com/wiki/Source_Multiplayer_Networking) · [Gambetta: lag compensation](https://www.gabrielgambetta.com/lag-compensation.html) · [Gaffer: Fix your timestep](https://gafferongames.com/post/fix_your_timestep/)
- [ZzFX](https://github.com/KilledByAPixel/ZzFX) · [MDN Web Audio spatialization](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Web_audio_spatialization_basics)
- [CrazyGames technical requirements](https://docs.crazygames.com/requirements/technical) · [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)
- [Chromium: SwiftShader fallback removal](https://groups.google.com/a/chromium.org/g/blink-dev/c/yhFguWS_3pM/m/oLrB5up_BwAJ)
