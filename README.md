# Physics Gym

**[Controller gym](https://tront.xyz/pid/)** · **[WebXR grab lab](https://tront.xyz/pid/vr/)** · **[Full Unity C# tutorial](https://tront.xyz/pid/tutorial/)** · **[Download the Unity starter](https://tront.xyz/pid/downloads/TrontPhysicsGym-Unity.zip)**

A practical playground for VR locomotion and grabbing. Watch eight simulated players compare force controllers, then pick up a Rigidbody in the WebXR or Unity lab and **switch controllers while the same object stays in your hand**.

## Start with the experiment

| Part | What you can do |
| --- | --- |
| [Eight-lane controller gym](https://tront.xyz/pid/) | Compare springs, velocity damping, backward PD, prediction and feedforward under shared inputs. |
| [Grab Lab](https://tront.xyz/pid/vr/) | Use a headset, adjustable desktop hands, or a repeatable guided workout. Hold objects, switch the drive live, press against walls, and climb fixed grips. |
| [Unity tutorial](https://tront.xyz/pid/tutorial/) | Go from an empty Unity 6/OpenXR project to a generated VR scene with real ConfigurableJoint and custom PD grabbing. |
| [Unity source kit](unity/) | Six runtime components, an Editor scene builder, and math checks. The ZIP includes the full tutorial and pinned original GorillaLocomotion reference. |

The Unity kit uses **native ConfigurableJoint / relative PD / backward PD / capped velocity servo** with acceleration feedforward as a separate custom-mode toggle. The browser uses **one-way PD / reaction PD / backward PD / Cannon point joint / capped velocity servo**. Cannon's point constraint leaves rotation free; it is not a reimplementation of the complete Unity joint.

### Unity quick start

1. Install Input System, XR Plug-in Management and OpenXR in a Unity 6 project. Enable the Input System.
2. Copy `unity/Assets/TrontPhysicsGym` into the project's Assets directory, or extract `Assets/TrontPhysicsGym` from the downloadable ZIP.
3. Run **Tools → Tront Physics Gym → Create Teaching Scene**, then **Run Math Checks**.
4. Enter Play Mode. Hold Q/E to grab with a virtual hand; press **C** while holding to change grab controllers and **N** to change contact architecture. The overlay lists the desktop hand controls.
5. Enable the OpenXR provider and Oculus Touch Controller Profile for the desired platform, resolve validation, and add the generated scene to the Build Profile. In the headset, **grip** grabs, **A** changes grab controller, **B** changes contact architecture, **X** toggles acceleration feedforward, and **Y** resets.

The [full tutorial](tutorial/tutorial.md) covers the exact setup, the force path, joint frames, target velocities, inverse mass scales, force caps, FireBlast's reported settings, filtering, tests, and Quest build steps. **Unity Editor compilation, Play Mode and physical-headset validation were not available during authoring.** Actual Unity math checks and a headset acceptance checklist are included; browser tests do not establish PhysX behavior.

## Separate the experiment’s choices

The grab controller and player-contact architecture are independent. In the Grab Lab choose **cast correction**, **finite-force contact servo**, or **off** without changing the held object. Select the pickup workout, airborne isolation, floor strokes, wall pressure, or external shove. Turn Repeat off for an unlimited run.

**Compare all controllers** records one baseline body-local input sequence and replays it unchanged in a background worker. Export the trace and results, including grip coverage, tracking error while held, body displacement and force saturation. A missed grab cannot win with a zero-error score.

The independent `GrabEnvironment` API exposes eight actions and thirty observations, deterministic reset, fixed stepping, and termination/truncation. It has **no reward or neural trainer**; this is a reusable environment/replay boundary for a separately defined learning task. See [architecture and scope](ARCHITECTURE.md) and [tutorial chapter 13](https://tront.xyz/pid/tutorial/#13-architecture-and-replay).

## Primary technical inspiration: Digital Opus

This project grew from **Digital Opus's explanations of moving rigidbodies with forces and torques**:

- [Controlling Objects With Forces and Torques I](https://digitalopus.ca/site/pd-controllers/)
- [Controlling Objects With Forces and Torques II](https://digitalopus.ca/site/controlling-objects-with-forces-and-torques-part-2/)
- [UsefulUtils source](https://github.com/Phong13/UsefulUtils)

Created by **Trent Sterling (Tront) and ChatGPT**, inspired by discussions with **Duck / Ducky (SCUG), FireBlast, and CometDev**. Additional technical foundations include David Wu's backward PD approach and *Stable Proportional-Derivative Controllers* by Jie Tan, Karen Liu and Greg Turk. The original locomotion reference is **Another Axiom's [GorillaLocomotion](https://github.com/Another-Axiom/GorillaLocomotion)**, pinned at `bc42e959cf3e69178f9147d89bd3ffeab1c432c4` and preserved byte for byte under `upstream/`. Full attribution and dependency licenses are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Using the eight-lane gym

- Choose an exercise: floor push, wall shove, climbing, air tracking, rapid reversal, wall pressure, or ceiling push.
- Compare the eight lanes together. Select a controller to read its explanation and equation.
- Tune frequency, damping, masses, force response, input speed, friction, and physics tick rate. Shared settings keep the comparison consistent.
- Use the camera controls to frame the gym or inspect a player. Orbit and zoom are available in the viewport.
- Pause, slow down, restart, or apply the same external impulse to every player.
- Change the starting distance and trial duration. Turn repeat off for a continuous run.
- Inspect tracking error, body speed, contact, and drive-force telemetry; export a run for comparison.

Tracking targets are body-relative: every player receives the same local motion, but their world-space targets diverge as their bodies move. During intentional wall or floor contact, a tracking gap is expected. A lower error score alone does not establish better locomotion.

## Controllers

| Controller | What it demonstrates |
| --- | --- |
| Spring only | Proportional position correction without damping. |
| PD, zero target velocity | Damping absolute hand velocity, which can oppose desired motion. |
| PD, velocity tracking | Correcting position and target-relative velocity error. |
| Backward PD | An implicit next-step adjustment for the idealized drive model. |
| Digital Opus SPD V2 | Explicit position lookahead from current velocities. |
| SPD V2 + feedforward | Adding the scripted target acceleration to the drive. |
| Adaptive backward PD | Lower damping far from the target, stronger damping nearby. |
| Contact-adaptive backward PD | Changing stiffness and damping while a hand touches a surface. |

The memorable `/pid/` URL covers this family of experiments. **The current controllers do not include an integral term.** Digital Opus's explicit SPD V2 example is also not the full implicit SPD algorithm from the research paper; the paper's stability guarantees should not be applied to it.

## Implementation and limits

Three.js renders the gym with WebGL. If WebGL is unavailable, a lightweight canvas renderer keeps the same simulation, camera controls, telemetry, and exercises running. Its simplified shading differs from the WebGL view. The simulation uses a fixed physics timestep, with interpolation for smooth rendering and a bounded recent-history buffer for long trials. UI values update existing text nodes instead of rebuilding the scoreboard.

The original eight-lane gym uses an **experimental translational contact model**, not PhysX, Rapier, or a measured Unity benchmark. Those hands and bodies do not form a complete articulated rigidbody rig. That model has no angular-inertia solve, joint solver, or full collision system.

The new Grab Lab uses **Cannon-es 0.20.0** rigidbodies, object torques, collision solving, native point constraints, and a swept-contact arm motor. It offers 72, 90 and 120 Hz with two internal solver substeps, plus independent cast / force / off contact modes. Both desktop and WebXR use the same core. The browser point joint caps each Cartesian constraint axis separately; custom PD caps vector magnitude. The player orientation is frozen, one hand can own each prop, and static-contact movement is a teaching approximation, not the exact GorillaLocomotion algorithm.

The Unity kit uses actual Unity/PhysX bodies and joints. Its independent contact selector offers Off, ForceServo, and CastCorrection teaching modes. The original stock source is included for inspection, outside Assets so it does not silently replace or compete with the teaching player. Controller stability statements for an ideal linear model do not automatically extend to contacts, saturation, nonlinear rotation or delayed tracking.

## Development

This is a static app with checked-in output. Serve the repository over HTTP, for example with `python3 -m http.server 8000`, and open `http://localhost:8000/` or `/vr/`. WebXR requires a secure context: use the published HTTPS URL on a headset, or a suitable HTTPS development server. Both browser labs use pinned, locally vendored Three.js and OrbitControls. The Grab Lab also vendors Cannon-es. No runtime CDN is required.

Application files:

- `index.html`: layout and accessible controls.
- `styles.css`: responsive interface and readable telemetry.
- `app.js`: UI, playback, graphs, and export.
- `sim.js`: independent controller trials and metrics.
- `scene.js`: Three.js rendering and camera controls.
- `canvas-scene.js`: software fallback for browsers without WebGL.
- `vr/physics.js`: shared desktop/WebXR rigidbody simulation, grab controllers, contact modes and scenarios.
- `vr/experiments.js`, `vr/experiment-worker.js`: exact-input replay, background comparisons, and a public environment adapter.
- `ARCHITECTURE.md`: what each model establishes, contributor clarification, and remaining acceptance work.
- `vr/app.js`, `vr/view.js`: desktop UI, tracked WebXR input, Three.js rendering and Canvas fallback.
- `tutorial/tutorial.md`: complete tutorial source, with static HTML beside it.
- `unity/Assets/TrontPhysicsGym/`: Unity runtime and Editor source.
- `upstream/`: unmodified original source and Git blob provenance.

Run source and physics checks:

```sh
node tests/simulation.mjs
node --test vr/tests/*.mjs
python3 scripts/validate-deliverables.py
```

Rebuild the ZIP after editing the Unity source or tutorial with `python3 scripts/package-unity.py`. Tutorial rebuild instructions are in [scripts/README.md](scripts/README.md). The downloadable archive is deterministic and checked against its source during publication.

The browser physics tests check actual grab state, live switching, reaction momentum, off-center torque, force/impulse units at multiple timesteps, static grips, two-hand averaging, tracking resets, contact sweeps, and repeatable workouts. They are not headset comfort or GPU performance tests.

## Hosting

GitHub Pages publishes the root of `gh-pages` at **https://tront.xyz/pid/**. The account-level custom domain supplies this project URL; no project `CNAME` is needed.

Push updates to `main`. The [Publish and verify Physics Gym workflow](.github/workflows/pages.yml):

1. Checks JavaScript syntax, the original gym tests, real-physics grab tests, source provenance, tutorial links, and the Unity ZIP contents.
2. Fast-forwards `gh-pages` to the exact source commit without forcing over independent history.
3. Explicitly requests a native Pages build and waits for that commit to finish.
4. Downloads every file in `PUBLIC_ASSETS.txt`, including the WebXR dependencies, tutorial, and Unity ZIP, and verifies each one byte for byte against the exact commit.

The empty `.nojekyll` marker preserves the static files as authored. Make ordinary edits on `main`; if `gh-pages` gains independent commits, reconcile them before the workflow can publish.

### Deployment setup

Pages was activated by creating `gh-pages` from the existing site commit through the authenticated GitHub integration, the same method used for the Fog and OKC projects. The publishing source is `gh-pages` at `/ (root)`. The workflow explicitly requests subsequent builds because a branch push authenticated with `GITHUB_TOKEN` does not trigger a Pages build by itself.

If a deployment fails, inspect its Actions run. Do not change the account-level custom domain to troubleshoot this project.
