# Sources, credits, and licenses

Created by **Trent Sterling (Tront) and ChatGPT**, from experiments and discussions with **Ducky / Duck (SCUG)** and **FireBlast**.

## Primary control inspiration: Digital Opus

The practical starting point for this project is Digital Opus's writing about controlling rigidbodies with forces and torques:

- [Controlling Objects With Forces and Torques I](https://digitalopus.ca/site/pd-controllers/)
- [Controlling Objects With Forces and Torques II](https://digitalopus.ca/site/controlling-objects-with-forces-and-torques-part-2/)
- [UsefulUtils](https://github.com/Phong13/UsefulUtils)

The tutorial discusses the ideas and links to the original explanations. It does not reproduce either article in full. Additional foundations: David Wu's backward PD approach, and *Stable Proportional-Derivative Controllers* by Jie Tan, Karen Liu, and Greg Turk. Our backward PD and the explicit SPD V2 experiment are separately identified; they are not interchangeable implementations of the research paper.

## Original GorillaLocomotion reference

- Repository: [Another-Axiom/GorillaLocomotion](https://github.com/Another-Axiom/GorillaLocomotion)
- Pinned revision: `bc42e959cf3e69178f9147d89bd3ffeab1c432c4`
- Reference directory: `upstream/GorillaLocomotion/`
- License: MIT, copyright 2021 Another Axiom. The complete original notice is in that directory's `LICENSE`.

`Player.cs`, `Surface.cs`, `README.md`, and `LICENSE` are preserved byte for byte, including original line endings. Their Git blob hashes are recorded in `upstream/PROVENANCE.json` and checked during publication. They are reference material outside the Unity kit's Assets directory, so the stock player is not silently compiled alongside the teaching motor.

The new Unity motor is a finite-force fixed-step teaching implementation inspired by cast/plant/release movement. The browser uses a separate swept-contact approximation. Neither is represented as the exact stock GorillaLocomotion algorithm or the current commercial Gorilla Tag implementation. The reference source is credited independently of the control theory.

## Browser dependencies

| Dependency | Pinned version | Location | License |
| --- | --- | --- | --- |
| Three.js | 0.170.0 | `vr/vendor/three.module-0.170.0.js` | MIT, `vr/vendor/THREE-LICENSE.txt` |
| OrbitControls | Three.js 0.170.0 | `vr/vendor/OrbitControls-0.170.0.js` | Same Three.js MIT notice |
| Cannon-es | 0.20.0 | `vr/vendor/cannon-es-0.20.0.js` | MIT, `vr/vendor/CANNON-LICENSE.txt` |

The Grab Lab vendors these dependencies so its runtime does not depend on a CDN. The original eight-lane gym still uses its pinned Three.js CDN imports. Build-only tutorial tooling is documented under `scripts/`; it is not loaded in a visitor's browser.

Our original code is available under the repository's MIT license. Each third-party component retains its own copyright and license. Trademarks and linked projects remain with their respective owners; no endorsement is implied.
