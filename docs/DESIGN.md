# THE QUIET — design notes for Build Brief Part 2 (S–Z)

This document explains how each section of the brief is realised and what it costs the player. Every
number is a default in code (`src/core/config.ts`, or the module named). The **Director's view (F1)**
shows each of these systems live.

## 0. Foundations assumed from Part 1

Part 2 refers to sections A–R. They were not in the repository, so the minimum each new layer needs
was built. If the real Part 1 differs, these are the seams to reconcile.

| Ref | Assumed meaning | As built |
|---|---|---|
| A | Entity senses | **Sight:** a cone of 115° (160° when alert), range 3.2 cells in darkness to 17 cells in light. Crouch ×0.6, standing still ×0.55, sprinting ×1.3. A lit torch lights you; the beam in its face is a beacon. **Hearing:** a threshold per state (rest 20 dB … listening 5 dB), lowered by the debt and by your stress. Sound loses 1.6 dB per cell and 14 more through a closed door. |
| B | Body language | **Head-tilt** = listening. **Inhale** = about to commit (lunge, dash, open a hiding place). **Slow turn** = leaving. **Snap** = the trap sprang. |
| G | States, nest | rest, roam, listen, investigate, hunt, chase, lunge, check, leave, feint, plan, feed, retreat, kill, mimic. Ambushes are plan steps that watch a killing ground. A head-tilt pauses a plan, it doesn't end it. It goes home to the nest to rest and to feed. |
| I | Hold breath | 8.5 s capacity, less when panting or wounded. A gasp is 46 dB. Releasing late makes a louder exhale. |
| J | Hiding, punishing pause | Lockers, morgue drawers, under beds (some beds have junk under them). After 30 s hidden (12 s late in the debt) the Director draws the Entity to your area and your spot's check score rises. |
| K | Persistence, knowledge tiers | Permadeath: every life is a new character. Entity Knowledge XP (death +3, escape +3, survived encounter +0.5 up to 3 per life, each new fake or counter +1). Tiers start at 4 / 10 / 18 / 30 XP. |
| L | Survivors | "L-lite": two per run. They hide, cough, talk, trade, call for help and can die. No escorting. |
| M | Light manipulation, mimicry | It breaks lights it walks to. It mimics voices and shapes. **No microphone input** ("mic-on mimicry" is noted below). |

Pacing is a three-phase Director: build → peak → relax. Relax windows shrink with the debt (Z), and a
chase is put on a **leash** (14 s early, about 34 s late). After that the Entity breaks off with the
slow-turn tell, which once learned may be a feint (Y). Fear is an input: stress tightens the
Director's guess of where you are and slightly sharpens the Entity's hearing.

---

## S. Unreliable senses

**Perceptual noise** (`director/perception.ts`). The live stress estimate (`director/stress.ts`) is
inferred from behaviour only: look-jitter, sprinting at nothing, how present the real threat is,
hiding, and ping-ponging in a corridor. False signals start above stress 0.28. Above that the rate is
`0.015 + 0.2·x^1.4` per second, at least 3–7 s apart. Kinds:

- **Shape:** the Entity's own sprite at the edge of vision, just inside the field of view, 5–12 cells
  away, in a dark (≤ 0.12) floor cell, in line of sight, never near the real Entity. It lasts
  0.45–1.1 s and vanishes the moment you look toward it or your beam touches it. Corridors rarely host
  one, since their edge of vision is wall.
- **Footsteps:** 3–5 of the Entity's footsteps behind or beside you, 5–10 cells away.
- **Door:** a door sound from a door 5–14 cells away that you cannot see.
- **Breath** (while hidden): breathing just outside your hiding place.

Phantom sounds go through the same propagation and synthesis as real ones and never reach the
Entity. Phantom shapes share the real Entity's art and its faint "pale skin" glow, so nothing on
screen distinguishes them. Flinching (snapping toward one, bolting, throwing, lighting the torch,
hiding) is logged and spikes stress. Fear feeds the noise that feeds the fear.

**The flashlight tax.** Torch reliance is the share of your time in darkness spent with the torch on
(a moving average).
- **Lull:** reliance above 0.55 for 70 s (25 s once learned) starts the lull. The Entity backs away
  from your beam, and it feels safe.
- **Betray:** after two such retreats (or 100 s), at a moment when you are in the dark, torch on, in
  the open, with it within 13 cells, the torch fails for 3.5–5.5 s and it comes for the light.
- **Exposed:** after that the beam is a beacon (visibility ×1.8). It remembers on later lives.

**No sanity bar.** Nothing on screen reports stress; tests assert no notice or subtitle mentions it.

## T. The bait economy

Plans (`director/bait.ts`) are short physical step lists the Entity must walk and perform
(`plans.ts`, interpreted in `entity.ts`). Nothing teleports.
- **When it plans:** the Director considers a plan every 4 s while the Entity is idling. The cooldown
  runs from 80 s down to 28 s as the debt rises.
- **What it predicts:** the planner predicts your route as the walking path to your next objective.
- **How plans end:** done, sprung (the trap caught you), interrupted, or aborted.

- **Herding** (tier 1+). It walks silently to a dark cell 8–16 cells ahead on your route, then knocks
  on the ductwork. The grate is chosen *at the moment of knocking*: 4–13 cells from you and at least
  4 cells farther from the ambush than you are. You flee the noise, toward it.
- **Object relocation** (tier 2+, or tier 1 late in the debt). It picks up a fuse or the key you
  still need (at least 8 cells away, out of your sight) and drops it at the back of a dark dead-end
  room. Then it camps outside the door for 75 s.
- **Offered safety** (all tiers). It opens a locker a hand's width, or clears the junk from under a
  bed, within 4 cells of your route, then lurks 6–10 cells off. If you take it, it comes to check
  4–9 s later. If it is busy then, it comes as soon as it is free.
- **Darkness funnels** (tier 1+). It finds two routes to your objective. It breaks up to four lights
  that serve the first route but not the second, and only if the second is lit. Then it waits in the
  dark beside the lit one. The only lit room is rarely safe.

## U. Corrupted objectives

- **The breaker** needs three fuses and a 3.5 s committed hold. It lights the whole map and is the
  loudest act in the game, heard everywhere (at least 60 dB at the Entity). After the first time it
  learns where you must stand. On later lives, once you hold the fuses, it waits 2.5–5 cells from the
  fuse box in the dark.
- **The rescue call:** the radio needs power. At tier 3 (or tier 2 if it has heard the radio before)
  it may answer first, in the rescuer's voice, naming the wrong gate: 65% on the first call, 55% on
  later ones. Then it goes to wait there. A tier-3 mimic stumbles very slightly ("we— we hear you");
  at tier 4 nothing gives it away. Rescue reaches the *real* gate 100 s after the first call, and
  only that gate opens.
- **False leads:** level logic plants a requisition note pointing at an empty zone and a pharmacy
  notice for a door with no key, plus a sealed Old Wing door. Time spent in a false lead's zone, or
  near a door that will never open, costs the debt double.

## V. Scent, heat & the mark

- **Thermal residue:** every surface you touch (doors, lockers, drawers, beds, taps, the fuse box,
  the radio, gates) holds heat that decays as `e^(−age/22)`. It is readable for about 38 s and gone
  after 60 s.
  - A hunting Entity scans every 0.4 s for prints within 7 cells whose surface it can see, and
    follows them newest-first to rebuild your path.
  - The newest print on a hiding spot draws a check with probability `0.3 + 0.6·heat`.
  - In cold zones the prints show as **condensation handprints** on the door or locker, so the
    player can learn the rule.
- **Breath fog** happens in cold zones (Nest, Morgue, Maintenance, the Garden, the Bay). It appears
  on every breath. The Entity can see it within 11 cells when lit, 5 when dark, and fog leaking from
  a hiding place gets that place checked. Holding your breath stops it, with the gasp risk from I.
- **The mark:** a wound, or a near miss within 2.4 cells, soaks your sleeve for 100 s. Every 3.5 s it
  gets your position (±1 cell), whatever zone you are in. Washing takes a 4 s hold at a tap, and the
  running water (34 dB every 0.5 s) commits you to a known, noisy spot. Once it has seen you wash,
  marking you sends it to watch the nearest tap.

## W. The nest — what it keeps

Built from the save (`nest.ts`, `persistence.ts`), deepest cells first, under a faint wet glow:
- a **sign** for each learned behaviour, examinable and never naming the mechanic (for example
  "figures scratched into the plaster, all turned away…" for the faked slow turn)
- up to 8 **survivors** it took
- the last 24 **trophies**: your torch, carried fuses, keys, bottles, scraps

At tier 2+ your **previous body** (the life just before this one, unless that life got out) is waiting. If you died in a locker or drawer, it is propped in that
spot half the time (you can't hide there any more). Otherwise it has been dragged to the nest. The
badge has your old name on it. It is near-suicide to enter: the Entity rests and feeds there, and it
has one way in.

## X. False company

- Two survivors per run (names, colours and voices from `hospital.ts`).
- They cough (more often when it is near).
- They talk: attachment +1 per new line, a battery gift +2. They ask for a battery once, and give a bottle
  back.
- When it kills one, it drags the body to the nest and feeds. While dragging, it ignores everything
  except you, loud and close.
- Sometimes they lean out and wave you over, exactly like a mimic would.
- When it hunts them they call for help every 5 s. Being within 9 cells when it gives up counts as
  saving them (+3 attachment).
- **The mimic** (tier 2+, or tier 1 once someone has died) chooses whom to wear with weight
  `0.3 + attachment + 2 if dead + 1 if met`. It holds that person's shape beyond 5.5 cells and calls
  in their exact name and voice. Within 3.2 cells the disguise drops and it lunges.
- Below tier 3 it sometimes repeats a phrase, a deniable tell.
- A dead survivor's body is dragged to the nest, and their voice is its to use: **already gone**.

## Y. The learned tell / meta-adaptation

**Faked tells.** Each real tell you could perceive (in view and lit, or audible) is scored by whether
you reacted "correctly" in its window:

| Tell | Correct reaction |
|---|---|
| tilt | freeze and stay quiet |
| inhale | move away or break line of sight |
| turn | move or leave hiding within 4 s |

Once a kind has been seen at least 3 times with accuracy `(read+1)/(seen+2) ≥ 0.62`, it learns to
fake it. After that it fakes with probability `min(0.85, 0.35 + 0.4·accuracy)`, in context:

- **Fake head-tilt:** a 9–12 s listen that outlasts your breath. The gasp is the bait.
- **Fake slow turn:** a feint. It walks about 3 cells, stops just out of sight and listens with
  360° awareness for 5–7.5 s. Any noise you make springs it.
- **Fake inhale:** at a hiding place you might be in. It inhales, never opens, and waits to see if
  you bolt.

Lies don't count toward your read accuracy. Learned fakes persist across deaths.

**Strategy dismantling.** An encounter runs from the first real threat (a chase, or alert within
9 cells) until 8 s without one. If you survive it, it records the tactics you used:

- `hide:<kind>`
- `distract` (it took the bottle)
- `doors` (you closed one in its face)
- `dark` (torch off during the encounter)
- `route:<corridor>` (where you broke line of sight)

A tactic that has saved you 3 times, including at least 2 of your last 3 escapes, is dismantled:

| Tactic | What it does instead |
|---|---|
| hiding kind | that kind scores +0.55 when choosing what to check, plus one extra check |
| distraction | it ignores the glass and walks to where you threw from |
| doors | it bashes through in 0.15 s instead of 0.6 s |
| dark | it hears the torch click as if it were 12 dB louder |
| route | it barricades a door on that corridor, or waits on it. A barricade takes a route, never the only way to the fuse box, the radio, a gate, a fuse or the key, and never a doorway someone stands in. Holding E forces it in 3.5 s, rattling the whole time and ending in a door bash it hears. The Entity shoves its own barricade aside if it walks through. |

**Moving goalposts.** Comfort accrues while stress is below 0.3, the Entity is active and you are
progressing. After 45 s of it the Director shifts something: an immediate plan, 60 s of stalking you
closely, or 90 s of more frequent fakes.

## Z. The debt

The floor is `1 − e^(−t/540)`. `t` runs faster while you linger:
- +0.6× while hidden for more than 20 s
- +1× inside a false lead
- +0.5× after 90 s with no progress while barely moving

That puts the floor at about 0.4 by 5 minutes and about 0.8 by 15. The floor:
- lowers hearing thresholds by 7 dB at most
- widens sight by up to 25%
- strengthens the pull toward you from 0.12 to 0.87
- shortens the build phase from 75 s to 15 s and relax windows from about 50 s to 5 s
- lengthens hunts and the chase leash
- speeds up the chase
- makes lights less steady, adds a dissonant voice to the drone, and makes the building creak more
  often

There is no clock; tests assert no notice ever shows one.

---

## Scope against the brief's notes

- **MVP-safe now:** S, T, V (all three senses, individually switchable), Y (faked tells, dismantling
  and moving goalposts), Z. All are complete and default on. Preset `mvp` turns on only these.
- **Needs survivors (v1.1+):** X. Built on L-lite; default on.
- **Later / high-knowledge:** U (rescue mimicry) and W (own remains) unlock through knowledge tiers 2–4.
  A fresh save plays without them; use `?tier=4` or the Director's view to preview.
- **Not built:** microphone-driven mimicry (M), vent travel for the Entity, escorting survivors.

## Balancing

`npm run campaign` plays twelve lives against one save with a scripted player. That player kills its
torch when chased, freezes on a tilt, creeps when hunted and hides when unseen. For each life the
report prints survival time, the debt reached, time chased, escapes, false signals and flinches, tells
(real and fake), plans and their outcomes, radio calls, and the nest's size. The defaults here came
from that loop. People will play differently: start with `TUNING` in `src/core/config.ts`, the
Director's leash and relax curves (`director/director.ts`), and the tier thresholds
(`persistence.ts`).

---

# Part 3 — Seen, heard, told, and shared

The brief's systems were first shown through a low-resolution raycaster with simple sound. This part
puts them in HD 3D with full 3D sound, adds a story and Director-staged jump scares, and lets up to
four people play the same run. With the story and scares switched off, a solo run with a given seed
plays out exactly as it did before this part (the system tests for S–Z run that way, unchanged). The
story never touches the Entity's senses or the Director; scares reach them only through your stress,
like any false signal, and through the one real noise of a falling ceiling tile.

## Shared runs in the simulation

- `Sim` holds one to four players (`config.players`). Every sense the Entity has samples every player
  and attends to the one it perceives best; a noise is propagated once and heard by each player at
  its own level and apparent direction.
- **The Director reads one person at a time** — the `focus`: whoever the Entity is engaged with, or
  else (re-chosen every 18–30 s) whoever has strayed from the others, then whoever is most afraid. It
  picks off the one who wanders alone.
- Each player has their own stress and their own **perception (S)**: phantoms are per head, and the
  events that carry them are addressed (`to`) to that player only.
- Fuses and keys belong to everyone; batteries and bottles are personal. A dead or escaped player
  watches whoever is still inside; the run ends when nobody is.
- Group decisions use their own random streams, so adding players never reshuffles what a solo run
  rolls.

## The story

The premise (in `storyText.ts`): in 1976 Dr. Elias Hale opened the Quiet Ward — the Silence Protocol,
isolation in an anechoic room for patients who heard voices. Patient 4, Ada Wren, nine, said she did
not hear a voice; she heard something *listening*. During her thirty-first session in 1979 a storm
took the power; the room's magnetic door would not open for forty-one hours. The room was empty.
Tonight the storm is back. You are on the night shift and you do not remember coming in. Every life
is somebody new, and the notebook fills with handwriting that is almost yours.

It is delivered without cutscenes, through the systems already there:

| Piece | How it works |
|---|---|
| **Case file** (12 pages) | Two pages per run (three in a shared run) lie on free item/note spots. Found pages stay found across every death and are readable in the notebook. Your name appears in the later ones. |
| **Visions** (9) | The first time you enter certain zones (some only once, some recurring, several unlocked by pages read), the screen goes sepia and overexposed and a remembered scene plays in a few lines. Never during a chase. |
| **Whispers** (12) | When it has been quiet too long, a word for one player only — more often as the debt rises. |
| **Wall writing** (13) | Words on the walls, more of them as you learn more. One wall of the nest lists the names of everyone it has taken. |
| **Intro and endings** | The intro changes with how many people have gone in and how much of the file you have. Endings depend on how you left and what you know; all twelve pages and an escape open the true ending. |

The story has its own random stream and never touches the Entity's senses or the Director's
pacing: it is what the building remembers, not what it does.

## Jump scares

`scares.ts`. A scare is a promise the game should keep rarely:

- None in the first 75 s. After that the Director rolls once a second, more likely the more afraid you
  are and the deeper the debt, less likely in a relax phase, and never during a real chase (a real
  chase needs no help). Each player then waits 95–170 s (45–80 s on *intense*) before the next.
- **Kinds:** the torch *flickers* and in the dark frame it is standing right there; *footsteps behind
  you* — turn around within a few seconds and it is in your face; a *face at the window* with a
  lightning flash; a ceiling tile *drops* (the one real scare: the thud is a real noise the Entity
  hears too, and the tile stays on the floor); while you hide, something *inhales* outside the
  locker; a *whisper*. The real lunge and kill get the same treatment (flash, shake, a stinger).
- Except the drop, scares are presentation only and feed your stress like any other false signal;
  they cannot hurt you. *Off / normal / intense* is an option, and the host's choice in a shared run.

## The picture

`src/render3d`. The renderer reads the simulation every frame and never writes to it.

- **Materials** are generated on the GPU at load from procedural recipes (plaster, tile, terrazzo,
  brick, concrete, metal, wood, fabric, skin, the Entity's corpse-skin, the nest's growth…): albedo,
  height-derived normals, roughness, metalness and AO in one multi-render-target pass per recipe.
- **The building's light is the simulation's light.** The per-cell light the Entity uses to see
  you (with line of sight to every fixture, flicker and failures) is uploaded each frame and lit into
  every material as a soft fill plus a pseudo-directional light toward the brightest neighbour, so
  normal maps and highlights read. What is dark in the game is dark on screen.
- **The torch** is a shadow-casting spotlight with a lens cookie (hot centre, reflector ring, soft
  spill), a faint volumetric cone that stops at the first wall, dust motes sized like real motes
  through a lens, and a faint bounce light from whatever the beam is on. It sits in your hand, right of
  and below the eye, and lags the view slightly.
- **Characters** are procedural rigs with eased joints: the Entity (an ear-dish head, a mouth at its
  centre), survivors, other players carrying their own torches, and bodies.
- **Outside:** a storm sky, rain that only falls where there is sky, lightning that lights every cell
  that can see the sky.
- **Post:** ambient occlusion (from solid things only), bloom, ACES tone mapping, then the horror
  grade — drained colour, cold shadows, vignette, grain, chromatic aberration — and the effects of
  fear and harm: the scare flash, the hurt edge, the vision's sepia, the tunnel of a held breath, the
  red fade of death.
- Quality presets scale texture size, shadow resolution and effects; dynamic resolution trades pixels
  (never effects) to hold ~20 ms frames. Without WebGL2 the original raycaster takes over.

## The sound

`src/audio`. No samples: every sound is synthesised from noise, partials, formants and grains, so
phantom sounds are, by construction, the same recipes as real ones.

- Sounds are placed with HRTF at the direction the simulation says they **arrive** from (round a
  corner, from the doorway), low-passed when the path is bent or blocked, and sent into a convolution
  reverb built for the kind of space you are standing in (tiled washroom, long corridor, small office,
  stairwell, outdoors, the inside of a locker…), crossfaded as you move.
- **Ambience:** room tone, rain on the roof and against the windows, wind, fluorescent buzz and air
  in the ducts once the power is back, drips in the cold, the building settling, distant pipes and
  doors — and, very rarely, a music box or a child humming.
- **Score:** never a tune. A drone that thickens with the debt and with fear, string clusters when
  you see or hear it (or think you do), a running pulse and stabs in a chase, and silence after every
  scare, because silence is the loudest thing in the building.
- **You:** footsteps by surface, breath that follows exertion, holding your breath and the gasp, and
  a heartbeat that rises with fear.
- Levels were measured in the browser (`AudioEngine.meter`): calm music and ambience both sit around
  −34 dBFS, your own footsteps peak around −22, thunder and scares around −12, with a limiter at −10.

## Shared runs over the network

`src/net`. One player hosts and runs the only real simulation; guests send input and receive what
happened.

- **Why not lockstep?** Running identical simulations everywhere and exchanging inputs would be
  lighter, but browsers do not agree on the last bit of `Math.sin` and friends, and a simulation this
  chaotic would drift apart within minutes.
- **The copy.** A guest builds the same run from the same seed and the same save the host's copy
  started from (taken before the host's copy wrote to it), so the building, the items, the names and
  the case-file pages match from the first step. After that the host sends **20 snapshots a second**,
  each containing only the rows that changed since that guest's last one (transports are reliable and
  in order). Positions and headings travel complete in every snapshot. About 14 KB/s down and 2 KB/s
  up per guest.
- **Smoothness.** A guest shows the run 0.1 s in the past and interpolates everything that moves
  between snapshots; events (sounds, scares, subtitles) are released with their snapshot so sound and
  picture stay together.
- **Your own body** cannot wait for a round trip. Movement is predicted with the simulation's own
  rules (`moveBody`, shared with `Player`) and reconciled against the host's acknowledged input:
  replay what the host has not played yet, and slide out small disagreements rather than snap. Looking
  around is exact — a backlog of input is folded together, never dropped — and the torch answers at
  once.
- **Failures.** A guest who goes silent keeps walking for half a second (a hiccup) and then stands
  still; one whose connection drops is lost in the building (their character dies). A host whose tab
  is hidden keeps the run stepping on a worker timer. Different versions of the game refuse to join.
- **Transports:** WebRTC data channels through PeerJS (the room code is the host's address on the
  public PeerJS server, whose TURN relays carry the game when a network forbids a direct line), or a
  WebSocket relay (`npm run server`) that also serves the game and is picked automatically by pages it
  serves.
