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
| G | States, nest | rest, roam, listen, investigate, hunt, chase, lunge, check, leave, feint, ambush, plan, feed, retreat, kill, mimic. It goes home to the nest to rest and to feed. |
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
  4–9 s later.
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

At tier 2+ your **previous body** is waiting. If you died in a locker or drawer, it is propped in that
spot half the time (you can't hide there any more). Otherwise it has been dragged to the nest. The
badge has your old name on it. It is near-suicide to enter: the Entity rests and feeds there, and it
has one way in.

## X. False company

- Two survivors per run (names, colours and voices from `hospital.ts`).
- They cough (more often when it is near).
- They talk: attachment +1 per new line, a battery gift +2.
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
| route | it barricades a door on that corridor (you can't open it), or waits on it |

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
