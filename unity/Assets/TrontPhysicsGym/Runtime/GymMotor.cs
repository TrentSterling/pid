using UnityEngine;

namespace Tront.PhysicsGym
{
    /// <summary>
    /// Teaching adaptation of cast/plant/release arm locomotion. The unmodified
    /// GorillaLocomotion Player.cs is separately vendored. This motor uses finite
    /// forces in FixedUpdate: it does not reproduce the original transform moves,
    /// velocity-zeroing, sliding solver, or velocity-history jump multiplier.
    /// </summary>
    [DefaultExecutionOrder(-50)]
    [RequireComponent(typeof(Rigidbody), typeof(CapsuleCollider))]
    public sealed class GymMotor : MonoBehaviour
    {
        public GymRigInput input;
        public GymHand leftHand, rightHand;
        public LayerMask worldLayers;
        public float handRadius = 0.07f;
        public float maxAcceleration = 60f;
        public float contactResponse = 28f;
        public float contactCorrection = 18f;
        public float maximumHandSeparation = 0.65f;
        public float desktopWalkSpeed = 2f;
        public bool motorEnabled = true;
        public bool LeftContact => states[0].planted;
        public bool RightContact => states[1].planted;

        struct ContactState { public bool initialized, planted; public Vector3 previous, anchor, normal; }
        readonly ContactState[] states = new ContactState[2];
        Rigidbody body;
        CapsuleCollider capsule;

        void Awake() { body = GetComponent<Rigidbody>(); capsule = GetComponent<CapsuleCollider>(); }

        void FixedUpdate()
        {
            // Room-scale HMD offset moves the physical capsule within the player root.
            // No Rigidbody/transform velocity is overwritten here.
            Vector3 headLocal = transform.InverseTransformPoint(input.head.position);
            capsule.height = Mathf.Clamp(headLocal.y, 0.65f, 2.4f);
            capsule.center = new Vector3(headLocal.x, capsule.height * 0.5f + 0.02f, headLocal.z);
            if (!motorEnabled) { ResetContacts(); return; }

            Vector3 sum = Vector3.zero;
            int count = 0;
            UpdateHand(leftHand, 0, ref sum, ref count);
            UpdateHand(rightHand, 1, ref sum, ref count);
            if (count > 0)
            {
                Vector3 desiredVelocity = Vector3.ClampMagnitude(sum / count, 8f);
                Vector3 acceleration = (desiredVelocity - body.linearVelocity) * contactResponse - Physics.gravity;
                body.AddForce(Vector3.ClampMagnitude(acceleration, maxAcceleration), ForceMode.Acceleration);
            }
            else if (!input.IsXR && input.Walk.sqrMagnitude > 0f)
            {
                Vector3 forward = Vector3.ProjectOnPlane(input.head.forward, Vector3.up).normalized;
                Vector3 right = Vector3.Cross(Vector3.up, forward);
                Vector3 desired = (forward * input.Walk.y + right * input.Walk.x) * desktopWalkSpeed;
                Vector3 horizontal = Vector3.ProjectOnPlane(body.linearVelocity, Vector3.up);
                body.AddForce(Vector3.ClampMagnitude((desired - horizontal) * 12f, 20f), ForceMode.Acceleration);
            }
        }

        void UpdateHand(GymHand hand, int index, ref Vector3 sum, ref int count)
        {
            ContactState s = states[index];
            Vector3 raw = hand.TargetPosition;
            if (hand.Held != null || !hand.Valid)
            {
                s.initialized = false; s.planted = false;
                hand.HasSurfaceContact = false; states[index] = s; return;
            }
            if (!s.initialized) { s.previous = raw; s.initialized = true; }
            if (s.planted && (Vector3.Dot(raw - s.anchor, s.normal) > 0.045f
                || (raw - s.anchor).magnitude > maximumHandSeparation)) s.planted = false;

            if (!s.planted)
            {
                Vector3 travel = raw - s.previous;
                float distance = travel.magnitude;
                if (distance > 0.0001f && Physics.SphereCast(s.previous, handRadius, travel / distance,
                    out RaycastHit hit, distance + 0.005f, worldLayers, QueryTriggerInteraction.Ignore))
                {
                    s.planted = true; s.normal = hit.normal;
                    s.anchor = hit.point + hit.normal * (handRadius + 0.002f);
                }
                // A short downward probe catches an already-near-floor hand at startup.
                else if (Physics.SphereCast(raw + Vector3.up * 0.025f, handRadius,
                    Vector3.down, out hit, 0.035f, worldLayers, QueryTriggerInteraction.Ignore))
                {
                    s.planted = true; s.normal = hit.normal;
                    s.anchor = hit.point + hit.normal * (handRadius + 0.002f);
                }
            }

            hand.HasSurfaceContact = s.planted;
            if (s.planted)
            {
                hand.SurfaceContactPosition = s.anchor;
                Vector3 trackedVelocity = input.trackingSpace.TransformDirection(hand.LocalVelocity);
                sum += -trackedVelocity + (s.anchor - raw) * contactCorrection;
                count++;
                // Retain the collision-resolved point, not a controller inside a wall.
                s.previous = s.anchor;
            }
            else s.previous = raw;
            states[index] = s;
        }

        public void ResetContacts()
        {
            states[0] = new ContactState(); states[1] = new ContactState();
            if (leftHand != null) leftHand.HasSurfaceContact = false;
            if (rightHand != null) rightHand.HasSurfaceContact = false;
        }
    }
}
