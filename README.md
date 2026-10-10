# THE QUIET

A systemic hospital horror prototype. St. Ashgrove General, the power is out, and something in the
building listens with its whole head.

**Pillars:** no scripted scares · the Entity is a system · fear is an input · no safe zone ·
permadeath with persistence.

This repository implements **Build Brief Part 2 (sections S–Z)**. The repo was empty when Part 2
arrived, so the Part 1 systems the brief builds on (Entity senses, the Director, hiding, knowledge
tiers, survivors, light manipulation…) were built first at the minimum depth the new layers need.
[`docs/DESIGN.md`](docs/DESIGN.md) records exactly what was assumed about each one.

It is a browser game: a software raycaster plus a self-contained, engine-agnostic simulation core
(`src/core`) with no DOM dependencies. The core could be lifted into another engine as-is.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173 — headphones recommended
npm test             # system tests: one suite per brief section, plus a long soak
npm run campaign     # balance report: a scripted player lives 12 lives against one save
npm run build        # static build in dist/
npm run build:single # one self-contained file, dist/the-quiet.html — double-click to play
npm run smoke        # boots the built game in headless Chromium (needs Playwright; see the script)
```

URL parameters: `?seed=1234` (reproducible run), `?tier=0..4` (force Entity Knowledge tier),
`?designer` (open the Director's view), `?mute`.

## Controls

| | |
|---|---|
| `W A S D` | move |
| mouse (click to lock) / `← →` | look |
| `Shift` | run (loud) |
| `C` toggle / `Ctrl` hold | crouch (quiet, slow) |
| `E` | use — **hold** for the breaker, the radio, a tap, a gate |
| `F` | torch |
| `Space` (hold) | hold your breath — too long and you gasp |
| `G` / right-click | throw a bottle |
| `J` | notebook (objectives, notes, and what previous lives wrote down) |
| `F1` or `` ` `` | **Director's view** (designer overlay) |
| `Esc` | pause |

The objective chain: find three fuses → restore the breaker (Maintenance, downstairs) → use the radio
(Security office) → reach the gate they name → survive until rescue opens it.

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
- **A colour-coded decision log** answering "why did it do that?"
- **Feature toggles** for every S–Z mechanic, `core` / `mvp` / `full` presets (mirroring the brief's
  scope notes), a knowledge-tier override, "new run" and "erase Entity memory".

## How the brief maps to the code

| § | Brief | Where | In one line |
|---|---|---|---|
| S | Unreliable senses | `director/perception.ts`, `render/raycaster.ts` | Above stress 0.28, false shapes at the edge of vision plus phantom steps, doors and breath, drawn and synthesised exactly like the real thing. The flashlight tax goes lull → betray → exposed. |
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
  player.ts        movement, stamina, breath-hold & gasp, torch, hiding, channelled actions
  entity.ts        senses, state machine, body-language tells, plan interpreter
  director/        stress, profile, pacing, perception (S), debt (Z), adaptation (Y), bait (T)
  objectives.ts    fuses → breaker → radio → gate (U)
  survivors.ts     survivors and mimicry (X)
  nest.ts          what it keeps (W)
  persistence.ts   Entity Knowledge across permadeath (K)
  sim.ts           orchestration; emits presentation events
src/render/        raycaster, procedural textures and sprites
src/audio/         procedural WebAudio
src/ui/            HUD, input, Director's view
tests/             one suite per section + soak + campaign
```

The presentation layer only reads the simulation and drains its events. Phantom (S) sounds and
shapes are flagged `phantom` in the event stream for the designer view. The audio engine and
renderer deliberately treat them exactly like real ones.

## Status and limits

- Tuned against a scripted player (`npm run campaign`), not people yet. It is hard by design. The
  levers are in `src/core/config.ts` (`TUNING`) and the Director's leash/relax curves.
- **Not built:** M's microphone-driven mimicry (the brief marks it optional; no mic is used), vent
  travel, survivor escorting, multiple floors.
- Pointer lock can be unavailable in sandboxed iframes. Keyboard turning (`← →`) always works.
- Spoken lines use the browser's speech synthesis when available. Subtitles always show.
