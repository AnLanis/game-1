# Design research: game feel, AI, progression, levels, touch and accessibility

Research date: 2026-09-30. Talks and videos were summarized from written summaries, slides and wikis; none were watched. The research sandbox blocked direct page fetches, so findings come from search-result summaries.

Tags: **[S]** means a value a source reported; **[R]** means our recommended starting value for tuning.

---

## 1. Game feel ("juice")

### Techniques from the sources

- **"The Art of Screenshake" (Nijman, Vlambeer) [S].** The talk adds effects one at a time:
  - lower enemy HP, then a higher rate of fire
  - bigger bullets, then a muzzle flash
  - *less* accuracy, which reads as more lively
  - impact effects and a hit flash
  - enemy knockback
  - permanence: casings and bodies stay on screen
  - screenshake, then hit-stop ("sleep")
  - gun kickback and shell ejection

  No single effect matters much, but stacked together they change how the game feels.
- **Screenshake (Eiserloh, GDC 2016) [S].**
  - Keep a `trauma` value from 0 to 1 that events add to and that decays linearly.
  - Shake strength is `trauma²`.
  - Drive the shake with smooth noise, not per-frame random numbers.
  - In 3D, prefer *rotational* shake.
- **Hit-stop [S].** 50–100 ms on a heavy hit. Much longer than that reads as lag.
- **Recoil [S].**
  - Counter-Strike keeps two things apart: a deterministic *pattern* (climbs vertically, then drifts sideways) and random *inaccuracy* that depends on movement. The pattern resets about 0.55 s after firing stops.
  - Modern shooters move the real aim point only a little. Most of the kick is a *visual* view punch on a damped spring that snaps back.
- **Viewmodel [S].** Three motions:
  - sway: rotation lags behind looking
  - bob: position moves with walking
  - spring inertia

  All of them scale down while aiming down sights (ADS).
- **Audio [S].**
  - Build each shot from five layers: transient, body, sub, mechanical, and tail.
  - The tail tells the player the space: indoors is a crack plus early reflections, outdoors is a long tail.
  - Overwatch's audio team aimed for a game you can "play by sound."
- **Hit markers [S].** The CoD4 "X" and "thwip" sound. The enemy's own reaction should carry most of the feedback; the marker confirms it.
- **Aim assist [S].** Three separate parts:
  - **friction**: slow the reticle down over a target
  - **magnetism**: nudge the shot toward a nearby target
  - **rotational follow**: turn the camera with a moving target

  For scale, Apex uses 0.6 strength on console and 0.4 on PC controller.
- **Responsiveness [S].** Control feels real-time when the delay between input and visible response stays under about 100 ms.
- **Design philosophy [S].**
  - Halo's "30 seconds of fun" means replaying that loop in new places, with new weapons, against new enemy mixes.
  - Doom (2016) "push forward" combat treats enemies as the resource.

### Implementation recommendations [R]

**Recoil.** Keep three separate systems: a small *aim* kick, a *visual* camera spring, and a *viewmodel* spring.

| Weapon | Aim kick per shot (pitch) | Visual punch |
|---|---|---|
| Rifle | 0.35–0.6° | 2–3× the aim kick |
| Pistol | 1.2–2° | 2–3× the aim kick |
| Shotgun | 3–5° | 2–3× the aim kick |

- Each weapon has a fixed horizontal pattern plus ±25% jitter.
- Aim recovers in 150–300 ms.
- The pattern resets after 0.4–0.55 s without firing.

**Screenshake (trauma).**
- Add +0.15 per shot, +0.4 when the player is hit, and +0.6–1.0 for an explosion.
- Decay about 1.5 per second.
- Rotation only: up to 2–3° of yaw and pitch, 1.5° of roll.

**Hit-stop.**
- Freeze only the *victim*: 40–60 ms on a normal kill, 80–120 ms on a headshot or the last enemy.
- Never freeze input or the camera.

**Muzzle flash.** Show it on the same frame as the click. Use a pooled light that is always in the scene and pulsed up; adding and removing lights makes Three.js recompile shaders.

**Hit marker.** Three states, shown for 120–200 ms:
- body: white
- headshot: yellow, with its own sound
- kill: red

**Viewmodel.** Render it in a second pass with its own camera (FOV 55–65°) after clearing depth, so the gun never clips into walls.

**FOV.** +6–8° when sprinting, and a 1–2° punch for heavy weapons and explosions. All of it is turned off by Reduced Motion.

**Audio.** Offset layers by 0–8 ms, vary pitch by ±4%, swap the tail per environment, run the master through a compressor, and cap the number of simultaneous voices.

---

## 2. Enemy AI

### What the sources describe

**F.E.A.R. (Orkin) [S]**
- Only three states: Goto, Animate, UseSmartObject.
- An A* planner works over actions.
- Squad behaviors (suppress, advance, search) are assigned to groups of nearby soldiers.
- The famous flanking was mostly an illusion: soldiers moved to the next cover point, and designers had placed that cover to the player's side.
- **Barks narrate decisions after they are made** ("He's flanking!").

**Halo [S]**
- Shallow behavior trees.
- Designers create tasks, each with a capacity, and a system spreads squads across the active ones.
- Standard encounter shape: territory → fallback → last stand.
- In playtests, players rated the *same* AI as smarter when enemies were harder to kill.
- Reactions are deliberately exaggerated: grunts flee when their leader dies.

**Doom 2016 [S].** **Attack tokens.** A demon must hold a token from a shared pool before it attacks. The tokens act as the player's attention budget. Demons are placed to stay *visible* to the player.

**Perception (Splinter Cell Blacklist) [S]**
- Three zones: a main view cone, a much wider peripheral area, and a small "sixth sense" zone behind.
- Raycasts to several body points.
- An awareness meter fills more slowly with distance, in peripheral vision, when the player is crouched, and when the player is still.

**Grace shots [S].** An enemy's first shots deliberately miss (BioShock, among many others).

**Left 4 Dead AI Director [S]**
- Tracks each player's "intensity."
- Cycles through phases: Build Up → Peak → Fade → Relax (30–45 s).
- Spawns enemies out of sight, at a moderate distance, measured along the route.

**Difficulty [S].** Scale several human-like parameters inside sensible ranges: reaction delay, aim error, and awareness speed. Keep a minimum reaction delay and never let aim error reach zero. Resident Evil 4 adjusts a hidden rank within bands.

### Implementation recommendations [R]

- **Behavior.** A small utility selector over: MoveToCover, Peek&Fire, Suppress, Advance, Flank, ThrowGrenade, Reload, Search, Flee. Add a **squad brain** that hands out roles each second: 1 suppressor, at most 1 flanker, the rest hold.
- **Attack tokens by difficulty.** Hitscan shooters get 2 / 3 / 4 tokens. Grenades share one global token with an 8–12 s cooldown. Snipers get their own pool. An enemy without a token still aims, moves and barks; it just doesn't fire.
- **Perception.**
  - 90° main cone plus 150° peripheral cone at half the fill rate.
  - Awareness fills in 0.4–1.5 s.
  - Gunshots are heard 40–60 m away; sprint footsteps 8 m away.

**Per-difficulty tuning**

| Parameter | Easy | Normal | Hard | Veteran |
|---|---|---|---|---|
| Reaction delay after spotting | 800 ms | 550 ms | 380 ms | 250 ms |
| Grace shots | 3 | 2 | 1 | 1 |
| Aim error at start of a burst (narrows during it) | 6° | 4.5° | 3° | 2° |
| Enemy HP | 0.8× | 1.0× | 1.25× | 1.5× |
| Damage to player | 0.5× | 1.0× | 1.3× | 1.6× |

- **Telegraphing.** A 400–700 ms wind-up before heavy attacks, plus a glint or laser. Grenades get a bark, an arc and a HUD indicator. Throw one only when the player has stayed behind the same cover for more than 3 s.
- **Suppression.** Near misses within 1.5 m raise an enemy's fear. It then takes cover, and its accuracy drops 30–50% for about 2 s.
- **Morale.** When the squad leader dies, or half the squad is down, the rest retreat or panic for 3–5 s, shown big and obvious.
- **Director-lite.**
  - Intensity rises with damage taken, near misses, and kills within 5 m, and decays 10% per second.
  - Hold back spawns for 15–30 s of Relax after a peak.
  - Spawn out of sight, 25–60 m from the player.

---

## 3. Progression, retention and replayability

### What the sources describe

**Mobile retention benchmarks [S]**

| Day | Median | Top 10% |
|---|---|---|
| D1 | ~22% | ~40% |
| D7 | ~4% | ~12% |
| D30 | ~0.7% | ~4% |

Dailies and streaks drive D1 and D3. Weeklies and collections drive D7.

**Seeded daily runs [S]**
- Spelunky's Daily: the same seed for everyone, one attempt, a daily leaderboard.
- Deep Rock Galactic's weekly Deep Dive has modifiers: Warnings make runs harder but give more XP; Anomalies are neutral or fun.

**Replaying the same map [S].** Hitman's Mastery: per-location challenges unlock new starting locations and items, so the same map is replayed with new tools.

**Weapon progression (Call of Duty) [S].** Weapon levels unlock attachments. Mastery camos come from challenges.

**Risk of Rain 2 item stacking [S]**
- Linear: +10% per stack.
- Multiplicative.
- Hyperbolic: `1 − 1/(1 + k·n)`, which never reaches 100%.

**Horde (CoD Zombies) [S]**
- Enemy HP is 150, +100 per round, then ×1.1 per round after round 9.
- At most 24 zombies alive at once in solo.

**Medals (Trackmania) [S].** Gold is the author time × 1.06, silver × 1.2, bronze × 1.5 (not re-verified).

**XP curve [S].** XP for the next level = `x · level^y`, typically x ≈ 1000 and y ≈ 1.5.

### Implementation recommendations [R]

**Stars**
- ★ Complete the mission.
- ★★ Beat par time.
- ★★★ Beat par time and meet a bonus condition (accuracy or no damage).

**Also**
- **Mission mastery challenges** that unlock modifiers and loadout options.
- **Modifiers.** Warnings give +25–50% XP (for example armored enemies, fog, double reinforcements). Anomalies are fun (low gravity, big heads).
- **Daily Op.** Seed from the UTC date, fixed modifiers, one ranked attempt. Add a weekly 3-stage "Deep Op."
- **Weapon XP.** Levels 1–10, each unlocking one attachment that trades stats (not pure power). Camos after that.
- **Horde.** Enemy HP `100 + 60·(w−1)` up to wave 8, then ×1.08 per wave. Enemy count `6 + 2w + 0.08w²`, with 12–16 alive at once. Every 5th wave is a heavy wave. Waves are separated by 10–15 s breaks.
- **Ghost replays.** Record position and yaw at 20 Hz, about 10 KB per minute.

---

## 4. Level design

### What the sources describe [S]

- **Three lanes.** Three routes between major areas, and three options (forward, left, right) from any cover.
- **Sightlines and cover.**
  - Sightlines set how far away fights happen.
  - Power positions should be readable and counterable.
  - Flow comes from several entrances and few frustrating chokepoints.
- **Doom arenas.** Quiet corridors alternate with open, vertical arenas that have many routes, like skateparks.
- **Procedural levels that feel designed.**
  - Deep Rock Galactic moved to hand-authored room shapes joined by random tunnels.
  - Dormans' method: generate the mission graph first, then the space around it.
  - Wave Function Collapse (WFC) handles tile adjacency rules.

### Implementation recommendations [R]

**Arena metrics**
- 30–60 m across, with 2–3 entrances.
- Hard cover every 4–8 m, 1–1.3 m tall (crouch height).
- One power position, reachable by at least 2 routes.
- Longest sightline about 40 m in rifle spaces and 15–20 m in close-quarters (CQB) spaces.
- A unique landmark visible from every entrance.

**Encounters.** Encounters declare tasks and fallback lines. Reinforcements spawn out of sight, 25–60 m away.

**Procedural generation.** Build the mission graph first (start → fights → objective → extract), then realize it in space. Validate every layout for connectivity and sightline length.

---

## 5. Mobile and touch

### What the sources describe [S]

- **CoD Mobile.** Simple Mode fires automatically when the crosshair is on an enemy. Aim assist is on by default. Gyro can be enabled for ADS only or all the time. A layout editor lets players move and resize buttons.
- **PUBG Mobile.** Gyro sensitivity is set per scope.

### Implementation recommendations [R]

- **Movement.** A floating move stick on the left 45% of the screen.
- **Look.** Drag on the right side. ADS multiplier 0.5–0.6.
- **Fire button.** Dragging from the fire button also aims.
- **Auto-fire (optional).** Fires after the crosshair has stayed on a target for 80–150 ms. Automatic weapons only.
- **Touch aim assist.**
  - Friction: 40–50% slowdown inside about 3°.
  - Magnetism: 2–3° inside 30 m.
  - Rotational follow: 30–40%.

  A controller gets about 60% of the touch values; a mouse gets none.
- **Controls basics.** Buttons at least 48 px. `touch-action: none`. Pointer Events tracked by `pointerId`.

---

## 6. Accessibility and UX

### What the sources describe [S]

- The most-cited problems are remapping, text size, color vision, and subtitles.
- Game Accessibility Guidelines: subtitles at most 38 characters per line, on a background.
- The Last of Us Part II offers accessibility presets, all adjustable afterwards.
- Wrong FOV is a major cause of motion sickness. Many players want 100–110°.

### Implementation recommendations [R]

- **Remapping.** Every action can be remapped. Hold or toggle for ADS and crouch. Invert Y.
- **Sensitivity and FOV.** Separate hip and ADS sensitivity. FOV slider from 70° to 110°.
- **Motion.** Separate sliders for shake, head bob and weapon sway, plus a Reduced Motion master switch.
- **Color.** Colorblind-safe enemy markers that never rely on color alone.
- **Barks.** Shown as captions with the speaker's name.
- **Assists.** Aim-assist strength slider.
- **HUD.** HUD scale, a hit-marker toggle, and damage numbers that can be turned off.

---

## Sources

- Nijman, "The Art of Screenshake": https://www.youtube.com/watch?v=AJdEqssNZ-U · https://github.com/colinbellino/screenshake
- Eiserloh, "Juicing Your Cameras With Math": https://www.gamedeveloper.com/programming/video-sprucing-up-cameras-with-math
- Hit-stop: https://www.scitepress.org/Papers/2024/124614/124614.pdf
- Recoil: https://www.strayspark.studio/blog/weapon-recoil-camera-shake-ue5-spring-vs-curve · https://www.theastronauts.com/2019/03/making-gun-come-to-life/
- Weapon audio: https://www.liortega.com/post/first-person-shooter-gun-sound-design · https://pcgamesn.com/overwatch/overwatch-devs-on-creating-a-game-you-can-play-by-sound-and-announcing-dolby-atmos-support
- Hit markers: https://pcgamer.com/the-origin-of-call-of-dutys-most-heard-sound · https://www.pcgamer.com/games/fps/hit-markers-are-an-fps-crutch/
- Aim assist: https://www.halopedia.org/Aim_assist · https://halopedia.org/Magnetism
- Doom: https://gdcvault.com/play/1024940/Embracing-Push-Forward-Combat-in · https://www.gamedeveloper.com/design/cyber-demons-the-ai-of-doom-2016-
- F.E.A.R.: https://gdcvault.com/play/1013282/Three-States-and-a-Plan
- Halo: https://gamedeveloper.com/game-platforms/in-depth-bungie-on-eight-years-of-i-halo-i-ai · https://www.gamedeveloper.com/design/combat-evolved-the-encounter-design-of-halo-3 · https://www.jmeiners.com/shamans/papers/ai/the_illusion_of_intelligence.pdf
- Perception: https://gdcvault.com/play/1020195/Modeling-AI-Perception-and-Awareness
- L4D Director: https://www.valvesoftware.com/publications/2009/ai_systems_of_l4d_mike_booth.pdf
- Retention: https://gamedevreports.substack.com/p/gameanalytics-mobile-gaming-benchmarks
- Dailies / Deep Dives: https://www.gamedeveloper.com/design/the-24-hour-ticket-examining-daily-runs- · https://deeprockgalactic.wiki.gg/wiki/Deep_Dive
- Risk of Rain 2 stacking: https://riskofrain2.wiki.gg/wiki/Item_Stacking
- Level design: https://80.lv/articles/the-last-of-us-multiplayer-level-design-process/ · https://book.leveldesignbook.com/process/layout/flow/circulation · https://www.pcgworkshop.com/archive/dormans2010adventures.pdf
- Mobile controls: https://www.ggrecon.com/guides/best-call-of-duty-mobile-season-9-settings-guide/
- Accessibility: https://gameaccessibilityguidelines.com/ · https://www.playstation.com/en-us/games/the-last-of-us-part-ii/accessibility/
