using System;
using UnityEditor;
using UnityEngine;

namespace Tront.PhysicsGym.Editor
{
    /// <summary>Runs the real Unity math/API functions. No mocking Unity or claiming headset validation.</summary>
    public static class GymMathChecks
    {
        [MenuItem("Tools/Tront Physics Gym/Run Math Checks")]
        public static void Run()
        {
            const float dt = 1f / 90f;
            GymControllerMath.Gains(6f, 1f, out float kp, out float kd);
            Near(kp, Mathf.Pow(12f * Mathf.PI, 2f), 0.001f, "frequency uses 2 pi f");
            Near(kd, 24f * Mathf.PI, 0.001f, "critical damping gain");
            Vector3 movingMatch = GymControllerMath.Acceleration(Vector3.zero, Vector3.zero, kp, kd, dt, true, Vector3.zero);
            Require(movingMatch == Vector3.zero, "Matched moving target must not be damped toward world-zero velocity.");
            Vector3 braking = GymControllerMath.Acceleration(Vector3.zero, -Vector3.right, kp, kd, dt, false, Vector3.zero);
            Require(braking.x < 0f, "Derivative term must oppose excess velocity.");
            Vector3 ff = new Vector3(2f, -1f, 0.5f);
            Require((GymControllerMath.Acceleration(Vector3.zero, Vector3.zero, kp, kd, dt, true, ff) - ff).sqrMagnitude < 1e-8f,
                "Acceleration feedforward should equal target acceleration at zero tracking error.");

            // Unconstrained scalar model: high gains should converge under this same
            // semi-implicit integration, not claim universal PhysX/contact stability.
            foreach (float hz in new[] { 2f, 6f, 40f, 120f })
            {
                GymControllerMath.Gains(hz, 1f, out float pGain, out float dGain);
                float x = 1f, velocity = 0f;
                for (int i = 0; i < 900; i++)
                {
                    float acceleration = GymControllerMath.Acceleration(new Vector3(-x, 0f, 0f),
                        new Vector3(-velocity, 0f, 0f), pGain, dGain, dt, true, Vector3.zero).x;
                    velocity += acceleration * dt; x += velocity * dt;
                    Require(!float.IsNaN(x) && Mathf.Abs(x) <= 1.001f, "Backward scalar response grew at " + hz + " Hz.");
                }
                Near(x, 0f, 0.001f, "Backward convergence at " + hz + " Hz");
            }

            Quaternion body = Quaternion.Euler(20f, 80f, -35f);
            Quaternion principal = Quaternion.Euler(15f, -25f, 40f);
            Vector3 inertia = new Vector3(2f, 3f, 5f);
            Vector3 axisWorld = body * principal * Vector3.right;
            Vector3 torque = GymControllerMath.InertiaTorque(body, principal, inertia, axisWorld);
            Require((torque - 2f * axisWorld).magnitude < 0.0001f, "Principal-to-world inertia frame order.");
            Quaternion rotation = Quaternion.Euler(30f, 60f, 90f);
            Quaternion equivalent = new Quaternion(-rotation.x, -rotation.y, -rotation.z, -rotation.w);
            Require(GymControllerMath.RotationVector(rotation, equivalent).magnitude < 0.0001f,
                "q and -q represent the same rotation.");
            Require(GymControllerMath.RotationVector(Quaternion.AngleAxis(350f, Vector3.up), Quaternion.identity).y < 0f,
                "Rotation error takes the shortest arc.");
            Quaternion neutral = GymControllerMath.JointTargetRotation(rotation, rotation, Vector3.right, Vector3.up);
            Require(Quaternion.Angle(neutral, Quaternion.identity) < 0.001f, "Native joint neutral target is identity.");
            Quaternion target = Quaternion.AngleAxis(30f, Vector3.up);
            Quaternion jointTarget = GymControllerMath.JointTargetRotation(target, Quaternion.identity, Vector3.right, Vector3.up);
            Require(Quaternion.Angle(jointTarget, Quaternion.Inverse(target)) < 0.001f, "Native local target uses inverse offset.");

            GameObject a = new GameObject("Math check body A"), b = new GameObject("Math check body B");
            try
            {
                Rigidbody ra = a.AddComponent<Rigidbody>(), rb = b.AddComponent<Rigidbody>();
                ra.mass = 1f; rb.mass = 75f;
                Near(GymControllerMath.EffectiveMass(ra, rb, true), 75f / 76f, 0.0001f, "Pair reduced mass");
                Near(GymControllerMath.EffectiveMass(ra, rb, false), 1f, 0.0001f, "One-way mass");
                ra.isKinematic = true;
                Near(GymControllerMath.EffectiveMass(ra, rb, true), 75f, 0.0001f, "Fixed grip reacts on player mass");
                Near(GymControllerMath.EffectiveMass(ra, rb, false), 0f, 0.0001f, "One-way fixed grip cannot move player");
            }
            finally { UnityEngine.Object.DestroyImmediate(a); UnityEngine.Object.DestroyImmediate(b); }
            Debug.Log("Physics Gym math checks passed: gains, derivative sign, feedforward, backward integration, quaternion/inertia frames, joint offset, reduced mass. Next: Unity Play Mode and headset acceptance checklist.");
        }

        static void Require(bool condition, string message) { if (!condition) throw new InvalidOperationException(message); }
        static void Near(float actual, float expected, float tolerance, string name)
        { Require(Mathf.Abs(actual - expected) <= tolerance, name + ": expected " + expected + ", got " + actual); }
    }
}
