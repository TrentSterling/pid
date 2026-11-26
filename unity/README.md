# Tront Physics Gym — Unity VR starter

**[Complete tutorial](https://tront.xyz/pid/tutorial/)** · **[WebXR companion](https://tront.xyz/pid/vr/)** · **[Repository](https://github.com/TrentSterling/pid)**

Hold the same Rigidbody and switch **ConfigurableJoint → Relative PD → Backward PD** without letting go. The teaching scene combines arm contact locomotion with real physics grabbing, fixed climbing grips, force limits, and a separate acceleration-feedforward toggle.

## Quick start

1. Create a Unity 6 project. Install **Input System**, **XR Plug-in Management**, and **OpenXR Plugin** from Package Manager. Enable the Input System in Active Input Handling.
2. Copy **`Assets/TrontPhysicsGym`** from the downloaded ZIP into your project's Assets directory. If using the repository instead, that folder is under `unity/`.
3. Let Unity compile, then choose **Tools → Tront Physics Gym → Create Teaching Scene**. The builder creates the scene, input actions, materials, and all component references. It also sets the fixed physics timestep to 1/90 second and reserves three free user layers.
4. Choose **Tools → Tront Physics Gym → Run Math Checks**, then enter Play Mode. Walk toward a cube with WASD, adjust a virtual hand, hold Q/E to grab, and press **C** to change controllers while still holding it.
5. For a headset, enable OpenXR for the correct build platform, add the **Oculus Touch Controller Profile**, resolve OpenXR Project Validation, and add the generated scene to your Build Profile. The kit requests a Floor tracking origin. Follow the complete tutorial for Quest build and device checks.

There is no dependency on XR Interaction Toolkit or a paid SDK. The kit owns its tracked camera and hand targets; do not add a second pose writer to them.

## Controls

| Action | Desktop | Touch / Quest |
| --- | --- | --- |
| Move / look | WASD / right mouse | Tracked head and arm contact locomotion |
| Grab left / right | Hold Q / E | Hold grip |
| Select virtual hand | 1 left, 2 right, 3 both | Move your hand |
| Move virtual hand | I/K forward/back, J/L sideways, U/O up/down | Tracked pose |
| Restore virtual hands | H | — |
| Switch controller, keep holding | C | A |
| Toggle acceleration feedforward | F | X |
| Reset scene | R | Y |

The desktop overlay also exposes custom reaction forces, the locomotion motor, and FireBlast's reported angular/mass preset. That preset is incomplete because his linear drive settings and full rig were not supplied.

## What is included

Six runtime C# components, the scene builder, and Editor math checks. The download also contains the full tutorial, implementation notes, licenses, and an unmodified snapshot of Another Axiom's original GorillaLocomotion source under `Reference/`. That reference is intentionally outside `Assets`; the active teaching motor is a separate implementation.

Read **`IMPLEMENTATION.md`** in the ZIP, or [implementation-notes.md](implementation-notes.md) in this repository, for force paths, units, known approximations, source references, and acceptance checks.

## Validation status

The C# was reviewed against Unity's documented APIs; math checks are included for execution inside Unity. **Unity compilation, Editor Play Mode, and a physical headset session were not available in the authoring environment.** Run the supplied acceptance checks before using this as a game foundation. The browser companion exercises a separate Cannon-es implementation and does not establish PhysX correctness or headset performance.

Created by **Trent Sterling (Tront) & ChatGPT**, from discussions with **Ducky / Duck (SCUG)** and **FireBlast**. **Digital Opus is the primary control inspiration.** Original locomotion reference: **Another Axiom**. Additional foundations: **David Wu**, and **Jie Tan, Karen Liu, and Greg Turk**.
