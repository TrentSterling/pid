# What this gym compares

Physics Gym has three connected teaching surfaces: eight controller lanes, an interactive grab lab, and a Unity C# kit. They share questions and experiments, not identical engine dynamics.

## The clarification that changed the experiment

In the discussion supplied by Tront on 27 November 2026, FireBlast clarified that his hands follow the controllers through velocity tracking, sphere-cast locomotion moves the player, and grabbing uses a separate custom controller mixture. We have a description, not his implementation. The `VelocityServo` examples here are our independent teaching implementations and do not reproduce his unpublished controller.

Keep these choices separate:

| Choice | This project exposes |
| --- | --- |
| Grab controller | Relative PD, backward PD, a capped velocity servo, and an engine-native constraint; browser also has an explicit one-way baseline. |
| Player contact behavior | Cast correction, finite-force contact servo, or off to isolate grabbing. |
| Input source | Repeatable guided inputs, desktop hands, tracked headset input, or the public replay/environment interface. |

Changing all three at once cannot tell you which change caused an improvement.

## Models and boundaries

| Surface | Implemented model | What it does not establish |
| --- | --- | --- |
| Eight lanes | Translational hand/body contact model, eight PD/spring variants, identical body-relative scripted motion. | Full rigidbody articulation, native joint behavior, headset feel. |
| Browser grab lab | Cannon-es dynamic props and upright player, native point joint or custom control, massless hand/query proxies, static box sweeps. | PhysX equivalence, a full dynamic-hand rig, moving-platform or zipline support. |
| Unity kit | Unity bodies, real ConfigurableJoint, custom force/velocity servo, switchable contact motor, OpenXR/desktop input. | A verified production rig. Unity compilation, Play Mode and physical-headset acceptance are still required. |

The browser point joint leaves object rotation free. Custom modes drive orientation. Point-joint limits act per Cartesian constraint equation; custom controllers bound a force or impulse vector. Unity and Cannon also differ in off-center effective-mass treatment. These are disclosed implementation differences, not proof that a controller family is better.

## Why solver integration matters

PhysX D6 drives are proportional-derivative drives integrated into the constraint solve. That can improve coupled-contact behavior compared with calculating a custom force outside that solve. Both methods actuate the world; calling one “real” and the other “fake” hides the actual questions about reaction, target frames and velocity ownership. Joint mass scaling is explicitly nonphysical and can still be useful game tuning.

Primary references: [PhysX joints](https://nvidia-omniverse.github.io/PhysX/physx/5.4.0/docs/Joints.html), [Unity ConfigurableJoint](https://docs.unity3d.com/6000.0/Documentation/Manual/class-ConfigurableJoint.html), [Unity connectedMassScale](https://docs.unity3d.com/6000.0/Documentation/ScriptReference/Joint-connectedMassScale.html), [Digital Opus](https://digitalopus.ca/site/pd-controllers/).

## Repeatable evidence

The browser comparison records a baseline body-local head/hand input sequence once, then replays those exact samples for each grab controller. Every row includes the same input hash. The environment and contact mode remain fixed. A missing grab produces no held-error score, rather than a misleading perfect zero. Grip coverage, peak displacement, force saturation and final speed accompany the tracking metrics.

Experiments cover the pickup/reversal/release workout, zero-gravity airborne arm motion, one/two-hand floor strokes, held-object wall pressure, and an external impulse. The airborne test isolates input-induced motion; it is not a normal-gravity jump. An origin displacement includes deliberate locomotion and is not automatically an error. Test 72, 90 and 120 Hz separately; equal frame counts at different rates would be different durations.

Export the comparison to retain settings, action trace, model notes, and results. Replaying a human or scripted trace compares responses. Training a separate policy for each controller compares how each policy learns to exploit its environment. Both are useful, but answer different questions.

## Learning interface

`vr/experiments.js` provides `GrabEnvironment`, `ACTION_SCHEMA`, and `OBSERVATION_SCHEMA`. It is an independent public adapter around this lab, with eight actions, thirty observation values, deterministic reset, fixed-step advance, explicit termination/truncation, and `reward: null`. A training task must supply its own reward and evaluation protocol. No neural trainer or saved policy is included.

The API is intentionally not described as compatible with an existing trained brain. Observation order, units, action meaning, decision rate, world dynamics and reward must all match, or a new policy must be trained. Start with recorded-action comparisons before training: a learned policy can exploit a penetration correction or reward mistake rather than discover a useful locomotion strategy.

## Remaining acceptance work

- Compile and generate the Unity scene in a fresh supported Unity/OpenXR project.
- Test each grab/contact combination in a physical headset, including overlapping release and tracking recovery.
- Check moving-support anchoring, carrier velocity, and rotating supports in Unity before extending the kit; the browser currently has static supports only.
- Treat ziplines, portals, multiplayer and fully simulated hand proxies as separate features, not implied by passing these tests.
- Measure CPU/GPU frame time on the actual Quest target before making a refresh-rate claim.

Technical foundations and attribution remain in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Primary control inspiration: Digital Opus. Project and discussion credits: Trent Sterling / Tront, ChatGPT, Ducky / Duck (SCUG), FireBlast and CometDev; original locomotion reference by Another Axiom.
