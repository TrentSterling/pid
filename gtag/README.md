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
| `../vr/tests/gtag.mjs` | Tests (run by CI with the other `vr/tests`). |

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
| ClimbPPO / learned policy | Not included. The environment is the boundary a policy would use; the 6-action planar ClimbPPO brain does not apply to this 8-action 3D interface. |

The numeric defaults are the ones common in Gorilla Tag clone tutorials, not Gorilla Tag's own tuning.
