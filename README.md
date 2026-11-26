# Physics Gym

**[Open Physics Gym at tront.xyz/pid](https://tront.xyz/pid/)**

Eight simulated VR players compare force controllers under the same body-relative hand inputs. Watch the whole gym, inspect a controller, and tune the response while the trial runs.

## Primary technical inspiration: Digital Opus

This project grew from **Digital Opus's explanations of moving rigidbodies with forces and torques**:

- [Controlling Objects With Forces and Torques I](https://digitalopus.ca/site/pd-controllers/)
- [Controlling Objects With Forces and Torques II](https://digitalopus.ca/site/controlling-objects-with-forces-and-torques-part-2/)
- [UsefulUtils source](https://github.com/Phong13/UsefulUtils)

Created by **Trent Sterling (Tront) and ChatGPT**, inspired by discussions with **Duck / Ducky (SCUG) and FireBlast**. Additional technical foundations include David Wu's backward PD approach and *Stable Proportional-Derivative Controllers* by Jie Tan, Karen Liu and Greg Turk.

## Using the gym

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

Three.js renders the gym. The simulation uses a fixed physics timestep, with interpolation for smooth rendering and a bounded recent-history buffer for long trials. UI values update existing text nodes instead of rebuilding the scoreboard.

The physics is an **experimental translational contact model**, not PhysX, Rapier, or a measured Unity benchmark. The hands and body do not form a complete articulated rigidbody rig. There is no angular-inertia solve, joint solver, or full collision system. Force caps, approximate contact friction, and scripted inputs affect the results. Use this to understand and compare behavior, then validate the chosen technique in the actual game rig.

## Development

This is a buildless static app. Serve the repository over HTTP, for example with `python3 -m http.server 8000`, and open `http://localhost:8000/`. Three.js and OrbitControls load from pinned CDN URLs.

Application files:

- `index.html`: layout and accessible controls.
- `styles.css`: responsive interface and readable telemetry.
- `app.js`: UI, playback, graphs, and export.
- `sim.js`: independent controller trials and metrics.
- `scene.js`: Three.js rendering and camera controls.

## Hosting

GitHub Pages publishes the root of `gh-pages` at **https://tront.xyz/pid/**. The account-level custom domain supplies this project URL; no project `CNAME` is needed.

Push updates to `main`. The [Publish and verify Physics Gym workflow](.github/workflows/pages.yml):

1. Checks the required files and JavaScript module syntax.
2. Fast-forwards `gh-pages` to the exact source commit without forcing over independent history.
3. Explicitly requests a native Pages build and waits for that commit to finish.
4. Downloads the public HTML, CSS, and all three JavaScript modules and verifies every file byte for byte.

The empty `.nojekyll` marker preserves the static files as authored. Make ordinary edits on `main`; if `gh-pages` gains independent commits, reconcile them before the workflow can publish.

### Deployment setup

Pages was activated by creating `gh-pages` from the existing site commit through the authenticated GitHub integration, the same method used for the Fog and OKC projects. The publishing source is `gh-pages` at `/ (root)`. The workflow explicitly requests subsequent builds because a branch push authenticated with `GITHUB_TOKEN` does not trigger a Pages build by itself.

If a deployment fails, inspect its Actions run. Do not change the account-level custom domain to troubleshoot this project.
