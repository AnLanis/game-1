# Market and video research: browser FPS in 2026

Research date: 2026-09-30. This feeds the [gap analysis](../05-gap-analysis.md).

## Method and limits

- The research sandbox blocked page fetches for most hosts: YouTube, Poki, CrazyGames docs and game pages, Wikipedia, FRVR, and several news sites. Only GitHub pages could be read in full. Most facts here come from search-engine summaries of those pages.
- Numbers backed by a single source are moderate confidence. Anything marked **(unverified)** could not be confirmed.
- **No video was watched and no transcript or comment section was read.** The video section is built from titles, dates, description snippets surfaced by search, tweet text, and articles about the videos. Each video insight is tagged by source: `[meta]` for video metadata, `[tweet]`, or `[article]`.

---

## 1. Competitors

| Game | Platform(s) | Engine | Modes | Monetization | Popularity signal | Standout | Weakness |
|---|---|---|---|---|---|---|---|
| **Krunker.io** | krunker.io, Steam client, FRVR network | Three.js (secondary sources) | FFA, TDM, CTF, Hardpoint, ranked, modded and custom maps | KR currency, spins, skin market, Premium subscription, ads | 200M+ lifetime players at the FRVR acquisition (2022). Steam client: ~26k reviews, 79/100. | Deep movement and full modding; the genre benchmark | Cheaters in ranked, low tick rate, backlash after the acquisition |
| **Venge.io** | Poki, own site, itch | PlayCanvas | Small-arena objective modes and FFA; 4 heroes with abilities; 10 weapons; hero cards | Skins, camos, ads | 50M+ plays on Poki | MOBA-lite depth in a very light HTML5 build | Only 3–4 players per arena |
| **Shell Shockers** | shellshock.io, CrazyGames, mobile | Babylon.js | Public and private matches, custom maps | ~80–90% ads; the rest split between cosmetics and a no-ads VIP tier | More than 2M MAU; daily peaks of 300–350k (2022); low seven figures of revenue a year | A silly premise anyone gets at once | Traffic follows the school calendar; schools block the URLs |
| **Kour.io** | Own site, CrazyGames, mobile web | Unverified | FFA, TDM, Gun Game, Hardpoint, battle royale, search-and-destroy, parkour; classes; map editor | Points and skins | "7M users in a month" (developer claim) | Krunker feel plus mobile and many modes | Client-side trust led to invisibility and currency exploits; a "downfall" followed within two months |
| **Deadshot.io** | Own site, CrazyGames | Unverified | FFA, TDM, Hardpoint, Kill Confirmed, Domination | Unverified | 9.1/10 from ~133k votes on CrazyGames | Movement tech: slide, air-strafe, shotgun-jump | High skill ceiling |
| **Voxiom.io** | Own site, CrazyGames, Poki | Unverified | Capture the Gems, battle royale | Unverified | Live since 2021 | Destructible voxel maps and crafting | Only two modes |
| **Bullet Force** | CrazyGames (WebGL), iOS, Android | Unity | TDM, FFA, Conquest, Gun Game; up to 20 players | Mobile in-app purchases plus portal ads | Since 2016, still updated in 2026 | "Console-quality" realistic look | Heavy Unity WebGL payload |
| **Kirka.io** | Own site, CrazyGames | Three.js (unverified) | Solo, TDM, Parkour, search-and-destroy; clans; map editor | Chests, skin trading, daily quests | — | Skin economy and user-made content | Slow pace; many public cheats |
| **1v1.LOL** | Web, mobile, Steam | Unity (unverified) | Build fights, battle royale | In-app purchases and ads | **Shut down permanently on 3 Nov 2025** | Fortnite-style building in a browser | Shows how fragile live-service games are |
| **BodyCamera Shooter** (single-player) | CrazyGames, **desktop only** | Unity 6 | Solo waves against AI | Portal ads | **9.4/10 from ~43k votes**; updated Sep 2026 | A "photoreal" bodycam look | No mobile version; heavy build |
| **MiniRoyale 2** | Own site and portals | PlayCanvas | Battle royale | Moved to web3 | Older title | A full battle royale in the browser | Dated; the web3 pivot |

No notable new multiplayer browser FPS launched in 2026. The notable 2026 newcomers are AI-built games (section 3).

## 2. Mobile references

| Game | Core loop | Retention hooks | Monetization |
|---|---|---|---|
| **Call of Duty: Mobile** | 5v5 multiplayer modes, battle royale, limited-time events | Seasonal battle pass with daily and weekly challenges | Free and premium pass tiers |
| **Critical Ops / Standoff 2** | 5v5 bomb defusal, Counter-Strike style | Ranked ladders, clans | Cosmetic skin economy |
| **Sniper 3D** | Hundreds of short single-player missions that award **stars**; weapon upgrades | Energy system, seasonal content | 500M+ downloads; ads plus in-app purchases |
| **Dead Trigger 2** | Missions with varied objectives (escort, collect, defend, turret) plus hideout upgrades | Varied objectives keep repeat runs fresh | Free to play |

GameAnalytics 2025 mobile benchmarks: top-quartile D1 retention ~26–28%, D7 ~7–8%, median session 5–6 minutes.

**What this means for Dusty Duty.** Sniper 3D and Dead Trigger 2, the single-player mobile shooters that last, use the loop Dusty Duty already has: short missions, stars, varied objectives. The difference is a meta layer that pulls players back: upgrades, dailies, seasons.

## 3. AI-built ("vibe-coded") Three.js shooters

### Claude of Duty (Matt Shumer, July 2026)

The original Dusty Duty README calls the game "in the spirit of Claude-of-Duty-style WebGL shooters."

**What it is**
- A Three.js WebGL2 FPS built by a fleet of AI agents from a single prompt. About 55k lines of code.
- Tech: HDR rendering, cascaded shadows, GTAO, TAA, 19 procedural materials, BVH collision, ragdolls, navmesh AI, and synthesized audio with convolution reverb.
- One market-street map, about 120 × 120 m, with buildings you can enter.
- **No external assets.** Every texture, mesh and sound is generated at load time.

**Why it went viral**
- The launch video, "sound on", reportedly reached 3.8M views in 3 days.
- The GitHub repo had about 3.4k stars and 521 forks at research time.
- The hooks: one prompt, zero assets, a comparison against a AAA franchise, and viewer disbelief ("folks were convinced it was fake").

**Weaknesses (from its README and a reality-check article)**
- Blind critics scored it 3.6–5.1/10 against real Call of Duty.
- Hands look like "blocky finger slabs" and enemies look like mannequins at a distance.
- Performance: 28–30 fps median on Apple Silicon at Retina resolution.
- It is a **tech demo with no game loop**: no progression, objectives, menus, scoring or mobile support.

### Wider trend

- **fly.pieter.com (Feb 2025)** reportedly reached $1M ARR in 17 days, then faded as attention moved on.
- **Vibe Jam 2025** drew about 1,000 entries and **Vibe Jam 2026** drew 945, with 242k players. Levels says entries now "look like stuff you could find on Steam."
- **mrdoob's three-quake (Jan 2026)** is a port of Quake to Three.js.
- Weaknesses common to the genre:
  - novelty spikes that fade
  - no game loop or progression
  - multiplayer security holes
  - an amateur look up close
  - poor low-end performance

## 4. Portal requirements (Poki and CrazyGames)

**Poki**
- Initial download **under 8 MB** is the target.
- 30 fps minimum and 60 fps target on mid-range mobile.
- Full-screen and 16:9 scaling on mobile.
- Call `gameplayStart()` on the player's first input, not on load.
- Commercial breaks only between gameplay sessions. `rewardedBreak()` is for opt-in rewards.
- No external ads, splash screens or outgoing links.
- Every game is hand-picked.

**CrazyGames**
- Initial download ≤ 50 MB, or **≤ 20 MB to qualify for the mobile homepage**.
- Total build ≤ 250 MB and at most 1,500 files.
- Metrics that decide whether a game progresses:
  - average playtime: **10+ minutes** for successful games
  - conversion (share who play at least 1 minute): **80%+** for top games
  - **D1 retention of 10–15%**
- Top games load in **under 10 s**.
- Quality rules:
  - gameplay starts within 1 click
  - onboarding happens inside gameplay
  - a controls overlay is shown
  - touch must be supported if mobile is claimed

**Ad rates.** Rewarded-video eCPM is roughly $15–28 in the US and about twice what an interstitial pays (unverified).

**What top web games have in common**
- Instant load and one-click play.
- Mobile support.
- Short, repeatable sessions.
- Visible progression: dailies and unlocks.
- Cosmetics that are not pay-to-win.

## 5. What players expect from a browser FPS in 2026

1. **Gameplay within seconds.** Under 10 s, no signup, and it runs on Chromebooks and low-end laptops.
2. **Gun feel.** ADS, recoil, hit markers, a kill feed and punchy audio. Slide, lean and mantle are now expected for a CoD-style fantasy.
3. **Progression.** Levels, unlocks, skins, daily quests, seasons.
4. **Variety.** Many modes, and user-generated content through map editors or seeds.
5. **Fairness.** Cosmetic-only monetization. Cheating is the top complaint about multiplayer browser shooters.
6. **Mobile and touch.** Desktop-only games lose the mobile homepage slot.
7. **Saved progress.**

## 6. Video findings (from metadata, not watching)

- **Claude of Duty coverage.** Videos include "AI-Generated Call of Duty FPS in Your Browser", "Someone Built a Call of Duty Clone With Claude Code", model shoot-outs ("ChatGPT vs Gemini vs Claude Make Call Of Duty"), and many Shorts.
  - `[meta]` Titles combine the franchise name, the AI angle ("one prompt") and endurance claims ("still running after 20 hours").
  - `[tweet]` The launch tweet told viewers to turn the sound on and stressed that everything was custom code. Disbelief drove shares.
- **Browser FPS roundups.** Examples: "I Ranked 10 Browser FPS Games in 2026", "Browser FPS Tier List", "TOP 10 Browser FPS Games (No Download)".
  - `[meta]` "No download" and "low-end PC" appear in almost every title. Instant access is the main selling point.
  - `[meta]` Rankings judge gameplay, mechanics and how competitive a game feels.
- **Kour.io's rise and fall.**
  - `[meta]` "The *NEW* Best Browser FPS Game!?" (Mar 2024) was followed by "The Downfall of Kour.io" (May 2024).
  - `[article]` A Medium post blames client-side exploits.
- **Krunker and Venge gameplay.** `[meta]` Thumbnails and titles center on **big numbers** (kill counts, streaks, "nukes"), new weapons and "INSANE". The moments shown are multi-kill streaks and sniper plays.
- **Three.js FPS devlogs.** Examples: "Three.js FPS Game Template", "THREE.JS FPS Demo – Navmesh and enemies" (2026), "InstancedMesh performance – DevLog 10".
  - `[meta]` Popular topics are navmesh AI, instancing and performance, and "making it fun" or "satisfying movement".
- **1v1.LOL shutdown.** `[meta]` Shutdown coverage became its own content genre.

**Lesson for us.** The clips that spread show multi-kill moments, a readable results or star screen, the "fully procedural / zero assets" framing, and sound on. Number-driven titles and superlatives get clicks.

## 7. Takeaways for Dusty Duty

1. **Single-player is a less crowded niche.** Multiplayer browser shooters struggle with cheating, servers and shutdowns. BodyCamera Shooter's 9.4/10 shows demand for a polished solo shooter, but it is desktop-only. A mobile-capable one fills that gap.
2. **Be a game, not a demo.** The main criticism of Claude of Duty is that it has no game loop. Dusty Duty's missions, stars and objectives are the answer, so lead with them.
3. **Playtime is the risk.** CrazyGames wants 10+ minutes of average playtime and 10–15% D1 retention. Three short missions will not get there. We need replayable content: seeds, dailies, a horde mode, progression.
4. **Load size and speed.** Aim well under Poki's 8 MB. Procedural assets make that possible. Precompile shaders so the first fights don't hitch.
5. **Performance.** 30 fps minimum and 60 target on Chromebooks and phones, using quality tiers and dynamic resolution.
6. **Touch has to be first-class.** Dual sticks, auto-fire, aim assist.
7. **Portal-friendly monetization.** Rewarded ads for revives or bonuses, midroll ads only between missions, cosmetic camos.
8. **A shareable hook.** A Wordle-style daily result to share, multi-kill medal moments, and "zero assets, one download."

## Sources

- Claude of Duty: https://github.com/mshumer/Claude-of-Duty · https://x.com/mattshumer_/status/2081054356405731740 · https://enterprisedna.co/resources/ai-pulse/ai-pulse-2026-07-27-claude-of-duty-one-shot-fps-demo-gets-a-skeptical-reality-ch/
- Vibe coding: https://levels.io/fly-pieter-com-vibecoded-flight-simulator · https://levels.io/winners-of-the-2025-vibe-code-game-jam · https://levels.io/vibe-jam-2026-winners-quality · https://github.com/mrdoob/three-quake · https://github.com/lappemic/awesome-ai-built-games
- Krunker: https://gamesbeat.com/frvr-acquires-free-to-play-shooter-krunker-io/ · https://steambase.io/games/krunker/reviews
- Venge: https://forum.playcanvas.com/t/showcase-venge-io/13609 · https://poki.com/blog/meet-onrush-studio · https://medium.com/poki/higher-success-rates-with-playtests-1e1316dd70fb
- Shell Shockers: https://newsletter.gamediscover.co/p/deep-dive-shell-shockers-multi-million
- Kour.io: https://www.crazygames.com/game/kour-io · https://medium.com/@floralleafs/kour-io-a-exploiters-playground-630f1d0eb6e0
- Others: https://www.crazygames.com/game/deadshot-io · https://www.crazygames.com/game/voxiom-io · https://www.crazygames.com/game/bullet-force-multiplayer · https://www.crazygames.com/game/kirka-io · https://www.crazygames.com/game/bodycamera-shooter · https://delistedgames.com/free-to-play-battle-royale-1v1-lol-shutting-down-on-november-3rd/
- Mobile: https://blog.udonis.co/mobile-marketing/mobile-games/call-of-duty-analysis · https://gamedevreports.substack.com/p/gameanalytics-mobile-gaming-benchmarks · https://en.wikipedia.org/wiki/Dead_Trigger_2
- Portals: https://sdk.poki.com/new-requirements.html · https://developers.poki.com/guide/requirements-quality · https://docs.crazygames.com/requirements/technical/ · https://docs.crazygames.com/requirements/quality/ · https://docs.crazygames.com/resources/basic-launch-metrics/ · https://www.w3.org/2018/12/games-workshop/papers/size-matters.html
- Videos: https://www.youtube.com/watch?v=f4SrY6Z4e-s · https://www.youtube.com/watch?v=1IJcDDk_Iw0 · https://www.youtube.com/watch?v=3sUywiVrBmU · https://www.youtube.com/watch?v=fzW_QADusiM · https://www.youtube.com/watch?v=9ad5jcXPbNw · https://www.youtube.com/watch?v=OHRQIFA-dFQ · https://www.youtube.com/watch?v=Kt6iq13XIX0 · https://www.youtube.com/watch?v=yPQYR0w05n0 · https://www.youtube.com/watch?v=bErbktcytGM · https://www.youtube.com/watch?v=7le0hA_2-Ls · https://www.youtube.com/watch?v=DyjmXndgueg · https://www.youtube.com/watch?v=dQZYJG_k1lA · https://www.youtube.com/watch?v=fMgIW2Kyad4 · https://www.youtube.com/watch?v=-T1HXMHriUY · https://www.youtube.com/watch?v=EyuTlyfUln8
