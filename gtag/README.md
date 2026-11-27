# Gorilla course

A JavaScript port of the Gorilla Tag locomotion loop (Another Axiom's MIT `Player.cs`, pinned under `upstream/`), a five-stage course, held cubes, and a scripted player behind an 8-action / 27-observation interface. It is the Three.js half of [tutorial chapter 14](../tutorial/#14-gorilla-locomotion-then-physics): the default player here, the ConfigurableJoint version in Unity.

Open `gtag/` on the site, or serve the repository root (`python3 -m http.server`) and visit `/gtag/`.

| File | Responsibility |
| --- | --- |
| `gorilla.js` | The locomotion port: box sweeps, hand sticking, velocity history, launch, a small body integrator, carryable cubes. No rendering. |
| `stages.js` | Course stages as data: boxes, cubes, goal, lesson text, `expert: false` where there is no scripted routine. |
| `env.js` | `GtagEnvironment`: reset, `step(action)`, `observe()`, schemas. No reward, no policy, no trainer. |
| `expert.js` | The scripted player. Reads only the observation, labels what it is doing. |
| `app.js`, `index.html`, `gtag.css` | The page: Three.js view, desktop hands, stage picker, sliders for the public `Player.cs` fields. |
| `rl/nn.js`, `rl/ppo.js` | MLP with manual backprop and Adam; Gaussian policy, GAE, PPO update. Written for this project. |
| `rl/task.js`, `rl/trainer.js` | Stage 1 as a learning task (reward, curriculum, 15 Hz decisions); the training loop, brain format, driver and held-out evaluation. |
| `ppo/` | The Monke PPO page, its training worker and the shipped brain. `scripts/train-monke.mjs` trains one like it (runs are time-limited, so not bit-identical). |
| `../vr/tests/gtag.mjs`, `../vr/tests/monke-ppo.mjs` | Tests (run by CI with the other `vr/tests`). |

## Status

| Item | State |
| --- | --- |
| Locomotion port (stick, average, head check, launch) | Implemented, unit-tested, browser-checked in headless Chromium. |
| Stages 1 slap, 2 steps, 4 carry, 5 gap with the scripted player | Implemented and tested from the **standard spawn only**. Offsetting the spawn by 0.2 to 0.8 m makes steps, carry and gap fail often. |
| Stage 3 wall climb | Playable by hand. **No scripted routine yet.** |
| Held cubes | Implemented. Carried mass shares launch momentum (`bodyMass / (bodyMass + heldMass)`); this is a teaching shortcut, not a joint. |
| Desktop hands | Implemented, lightly checked (mouse and keys run without errors). Not play-tested for feel. |
| WebXR / headset | **Not implemented here.** Use the Grab Lab. |
| ConfigurableJoint (physics) version | Design only, in chapter 14. Not compiled in Unity, not in the Unity kit yet. |
| Monke PPO (`ppo/`, `rl/`) | Implemented. Hand-written MLP, Adam, GAE and PPO, a training worker, a four-key player and a PPO driver for stage 1. Tested in Node (11 tests) and in headless Chromium. Not play-tested by a person, not checked on a phone or in Safari or Firefox. |
| What the policy learned | Reaching the pad on stage 1 (12 m), using 4 of the 8 action channels (hand height and forward/back; sideways and grip are ignored on this stage). It does not have to stop on the pad, and it hops rather than walks. Other stages are not trained. |
| Shipped brain (`ppo/brain.json`) | Seed 1, 371k decisions, about 2.5 minutes on one Node thread. Reached the pad in 100 of 100 held-out spawns, and 100 of 100 at double spawn jitter. |
| Multi-worker training | Not implemented. One training thread. |

The numeric defaults are the ones common in Gorilla Tag clone tutorials, not Gorilla Tag's own tuning.
