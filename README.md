# Physics Gym

Interactive 3D PD, PID and SPD playground for game physics and VR locomotion.

Live site: https://tront.xyz/pid/

## Controls
Compare eight independent players receiving synchronized body-relative hand inputs. Choose floor push, wall shove, climbing or air tracking. Adjust gains, mass, timestep, starting distance and trial duration. Disable repeat for continuous simulation.

## Credits
Created by Trent Sterling (Tront) and ChatGPT, inspired by discussions with Duck (SCUG) and FireBlast.

Primary technical inspiration: **Digital Opus**:
- [Controlling Objects With Forces and Torques I](https://digitalopus.ca/site/pd-controllers/)
- [Controlling Objects With Forces and Torques II](https://digitalopus.ca/site/controlling-objects-with-forces-and-torques-part-2/)
- [UsefulUtils](https://github.com/Phong13/UsefulUtils)

Additional foundations: David Wu's backward PD approach and Stable Proportional-Derivative Controllers by Jie Tan, Karen Liu and Greg Turk.

## Status
Experimental educational simulation, not a PhysX benchmark. Three.js rendering with simplified translational contact physics. Full rigidbody backend and Unity export are future work.

## Hosting
GitHub Pages publishes the root of the `gh-pages` branch at https://tront.xyz/pid/. The account-level custom domain supplies this project URL; no project `CNAME` file is needed.

Push updates to `main`. The [Publish and verify Physics Gym workflow](.github/workflows/pages.yml) fast-forwards `gh-pages` to the source commit, explicitly requests a Pages build, waits for that commit to finish, and verifies the live `index.html` byte for byte. It refuses to overwrite independent commits on `gh-pages`; make normal edits on `main`.

The empty `.nojekyll` file preserves the static HTML as authored. The browser loads Three.js from a pinned CDN URL.

### Deployment setup

Pages was activated by creating `gh-pages` from the existing site commit through the authenticated GitHub integration, the same method used for the Fog and OKC projects. The repository publishes from `gh-pages` at `/ (root)`. The workflow explicitly requests each subsequent build because a branch push using `GITHUB_TOKEN` does not trigger a Pages build by itself.

If a deployment fails, inspect the workflow in Actions. Do not change the account-level custom domain to troubleshoot this project.
