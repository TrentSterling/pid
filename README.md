# Physics Gym

Interactive 3D PD, PID and SPD playground for game physics and VR locomotion.

Target site: https://tront.xyz/pid/

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
Serve the repository root using GitHub Pages (main branch, root folder). The browser loads Three.js from a pinned CDN URL.
