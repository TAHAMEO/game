# THE QUIET

A psychological horror game. St. Ashgrove General, 3:12 a.m. The storm took the power, you are on
the night shift, and you do not remember coming in. Something in the building listens with its
whole head — and it remembers every one of you.

**Pillars:** the Entity is a system, not a script · fear is an input · no safe zone · permadeath
with persistence · sound first.

What is in it:

- **HD 3D graphics** (Three.js, WebGL2): every surface painted procedurally on the GPU as a
  physically-based material, a shadow-casting hand torch with a lens cookie, volumetric beam, dust
  and bounce light, the building's own light computed by the simulation, rain and lightning,
  ambient occlusion, bloom, SMAA and a filmic horror grade. Full resolution — nothing pixelated.
  Four quality presets plus dynamic resolution.
- **Full mouse look**, up and down as well as left and right.
- **3D sound**: every sound synthesised and placed in the building with HRTF, heard from where it
  *arrives* (round corners: from the doorway), muffled through doors, in a convolution reverb
  shaped like the room you stand in; a score that follows what you perceive; your own heart.
- **A story** told through twelve case-file pages hidden in the building (they stay found across
  deaths), visions, whispers, words on the walls, and endings that change with what you know —
  including a true ending.
- **Jump scares** staged by the Director: paced to your fear, never two close together, and
  completely switchable (off / normal / intense).
- **Play with friends**: up to four of you in the same building, over the internet
  (peer-to-peer, with a room code) or through a relay server on your own network.

[`docs/DESIGN.md`](docs/DESIGN.md) explains every system and the reasoning behind it.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173 — headphones, lights off
npm test             # system tests: one suite per brief section, shared runs, networking, soak
npm run campaign     # balance report: a scripted player lives 12 lives against one save
npm run build        # static build in dist/
npm run build:single # one self-contained file, dist/the-quiet.html — double-click to play
npm run server       # serve dist/ and a multiplayer relay on :8787 (LAN parties, your own server)
npm run smoke        # boots the built game in headless Chromium (needs Playwright; see the script)
```

URL parameters: `?seed=1234` (reproducible run), `?tier=0..4` (force Entity Knowledge tier),
`?designer` (open the Director's view), `?mute`, `?q=low|medium|high|ultra` (graphics preset),
`?retro` (the old raycaster), `?join=CODE` (open the join screen with a room code).

A browser with WebGL2 is needed for the HD renderer (any current Chrome, Edge, Firefox or Safari).
Without it the game falls back to the original low-resolution raycaster.

## Controls

| | |
|---|---|
| `W A S D` | move |
| mouse (click to lock) | look — up, down and around |
| `← →` / `PageUp PageDown` | look without a mouse |
| `Shift` | run (loud) |
| `C` toggle / `Ctrl` hold | crouch (quiet, slow) |
| `E` | use — **hold** for the breaker, the radio, a tap, a gate |
| `F` | torch |
| `Space` (hold) | hold your breath — too long and you gasp |
| `G` / right-click | throw a bottle |
| `J` | notebook: tonight's tasks, the case file, the handwriting of previous lives |
| `← →` / click, once you are out | watch someone still inside (shared runs) |
| `F1` or `` ` `` | **Director's view** (designer overlay; host only in shared runs) |
| `Esc` | pause |

The objective chain: find three fuses → restore the breaker (Maintenance, downstairs) → use the radio
(Security office) → reach the gate they name → survive until rescue opens it.

## Options

**Picture:** graphics preset (automatic, low, medium, high, ultra), brightness.
**Sound:** master, music, effects and voice volume; speak the voices aloud.
**Controls:** look speed, invert mouse up/down.
**The next run:** jump scares (off, normal, intense), the story on or off, feature layers.

| Preset | Textures | Shadows | AO | Bloom | AA | Beam, dust | Rain |
|---|---|---|---|---|---|---|---|
| low | 512 / 256 | 512 | — | — | FXAA | — | 400 |
| medium | 1024 / 512 | 1024 | — | ✓ | SMAA | ✓ | 1200 |
| high | 1024 | 2048 | ✓ | ✓ | SMAA | ✓ | 2500 |
| ultra | 2048 / 1024 | 4096 | ✓ | ✓ | SMAA | ✓ | 4000 |

*Automatic* picks from the graphics card; the renderer then trades resolution (never effects) to keep
frames under ~20 ms.

## Play with friends

1. One of you chooses **Play with friends → Host a game** and reads out the five-letter room code
   (or sends the invite link).
2. Everyone else chooses **Play with friends**, types the code and **Join**.
3. The host picks the jump-scare level and whether the story is on, and presses **Go in together**.

Up to four people. Over the internet the game connects you peer-to-peer (WebRTC; the public PeerJS
server only introduces you, and its TURN relays carry the game when a network forbids a direct line).
For a LAN party, or a network that blocks peer-to-peer, run `npm run build && npm run server` on one
machine and have everyone open its address (`http://<that machine>:8787/`): the game then uses that
relay automatically. *Connection* on the friends screen lets you point at any relay by hand.

In a shared run the Entity hunts all of you, but the Director reads one person at a time: whoever it
is after, or whoever has strayed from the others. Fuses and keys belong to everyone. Each of you has
your own fear, and your own hallucinations — what you see at the edge of your vision, your friends do
not. When you die (or get out) you watch whoever is still inside. The run ends when nobody is left
in the building. Case-file pages found together count for everyone's own notebook.

## The Director's view (F1)

There is deliberately no stress meter, no sanity bar and no clock in the game. Press **F1** to see
everything the player is never shown:

- **Live map:** lights, doors (open, locked, jammed), hiding spots (occupied, ajar, baited), items
  (relocated ones are drawn larger), warm handprints, breath fog, noise rings, survivors, phantoms,
  the Entity's FOV, last-known position and active plan.
- **A readout per brief section:** stress and its components, the false-signal count, the
  flashlight-tax phase, the debt floor and its lingering penalties, tell reads and which tells
  it now fakes, the current encounter's tactics, dismantled tactics, the active plan and recent plan
  outcomes, the mark, radio calls (real or fake), survivors' attachment, and the nest.
- **A colour-coded decision log** answering "why did it do that?" — including the story's visions
  and whispers and every scare the Director stages.
- **Feature toggles** for every S–Z mechanic, `core` / `mvp` / `full` presets (mirroring the brief's
  scope notes), a knowledge-tier override, "new run" and "erase Entity memory".

## How the brief maps to the code

| § | Brief | Where | In one line |
|---|---|---|---|
| S | Unreliable senses | `director/perception.ts`, `render3d/actors3d.ts` | Above stress 0.28, false shapes at the edge of vision plus phantom steps, doors and breath, drawn and synthesised exactly like the real thing. The flashlight tax goes lull → betray → exposed. |
| T | Bait economy | `director/bait.ts`, `entity.ts` (plan interpreter) | Herding by knocking on the ducts behind you, moving the item you need into a dead end, leaving a locker ajar on purpose, killing the lights on all but one route. |
| U | Corrupted objectives | `objectives.ts`, `world.ts`, `bait.ts` | The breaker is the loudest act in the game. Once learned, it waits beside the fuse box. At tier 3–4 it answers the radio in the rescuer's voice and names the wrong gate. Notes and locked doors lead nowhere. |
| V | Scent, heat & the mark | `entity.ts` senses, `player.ts`, `world.ts` | Warm handprints a hunter can follow (visible as condensation in cold zones), breath fog in the cold, and a scent mark that tracks you across zones until you wash it off at a tap. |
| W | The nest | `nest.ts`, `persistence.ts` | Trophies, the survivors it took, physical signs of every behaviour it has learned, and at tier 2+ your previous body. |
| X | False company | `survivors.ts`, `bait.ts` | Real survivors hide, talk, trade and call for help. At tier 2+ it wears them, name and voice, weighted toward the ones you cared about or that are already gone. |
| Y | Learned tell / meta-adaptation | `director/adaptation.ts` | Read its tilt, inhale or turn reliably and it starts faking them. Escape the same way three times and that way gets dismantled. Comfort triggers a shift. |
| Z | The debt | `director/debt.ts`, `director/director.ts` | The awareness floor rises with the clock and faster while you over-hide, dither or chase false leads. Silences shrink. There is no clock on screen. |

## Architecture

```
src/core/          simulation (no DOM): fixed 1/60 s step, seeded RNG, pure TypeScript
  hospital.ts      the map (two aligned ASCII layers) + zones, locks, names
  level.ts         parsing, regions (rooms / corridors / dead ends), grid line-of-sight
  world.ts         doors, hiding spots, items, notes, taps, vents, heat, fog
  lighting.ts      per-region fixtures (mains / emergency / lamps), breakable
  sound.ts         grid sound propagation; closed doors muffle
  player.ts        movement (shared with network prediction), stamina, breath, torch, hiding
  entity.ts        senses, state machine, body-language tells, plan interpreter
  director/        stress, profile, pacing, perception (S), debt (Z), adaptation (Y), bait (T)
  objectives.ts    fuses → breaker → radio → gate (U)
  survivors.ts     survivors and mimicry (X)
  nest.ts          what it keeps (W)
  story.ts         case files, visions, whispers, wall writing, endings (text in storyText.ts)
  scares.ts        Director-staged jump scares
  weather.ts       the storm (lightning everyone sees)
  persistence.ts   Entity Knowledge and the story across permadeath (K)
  sim.ts           orchestration for 1–4 players; emits presentation events
src/render3d/      the HD renderer: GPU texture generation, level geometry and furniture,
                   grid light, torch, characters and the Entity, sky and rain, post-processing
src/audio/         procedural 3D audio: synthesis, recipes, reverb, ambience, score
src/net/           shared runs: sessions (solo / host / guest), snapshots, prediction,
                   PeerJS and relay transports, the lobby
src/ui/            HUD, input, settings, Director's view
src/render/        the original raycaster (fallback without WebGL2)
server/relay.mjs   static server + WebSocket relay for shared runs
tests/             one suite per section + shared runs + networking + soak + campaign
dev/               render/audio/multiplayer harnesses used for visual and audio QA
```

The presentation layer only reads the simulation and drains its events. Phantom (S) sounds and
shapes are flagged `phantom` in the event stream for the designer view; the audio engine and
renderer deliberately treat them exactly like real ones. In a shared run the host runs the only
real simulation; each guest keeps a copy built from the same seed and save, kept in step by
snapshots, with the guest's own movement predicted locally (see DESIGN.md, part 3).

## Status and limits

- Tuned against a scripted player (`npm run campaign`), not people yet. It is hard by design. The
  levers are in `src/core/config.ts` (`TUNING`) and the Director's leash/relax curves.
- **Not built:** M's microphone-driven mimicry (the brief marks it optional; no mic is used), vent
  travel, survivor escorting, multiple floors, voice chat, rejoining a run after a dropped
  connection (a dropped player's character is lost in the building).
- Shared runs need everyone on the same version of the game; the Director's view only works on the
  host's machine. Over the internet they depend on the public PeerJS server to introduce players —
  `npm run server` is the alternative.
- Pointer lock can be unavailable in sandboxed iframes. Keyboard look (`← →`, `PageUp PageDown`)
  always works.
- Spoken lines use the browser's speech synthesis when available. Subtitles always show.
