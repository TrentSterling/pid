using UnityEngine;

namespace Tront.PhysicsGym
{
    /// <summary>
    /// Independent empty-hand locomotion comparison. ForceServo is a bounded
    /// acceleration controller; CastCorrection applies swept geometric corrections.
    /// Neither is FireBlast's unpublished implementation or a faithful upstream port.
    /// Grab controllers live in GymHand and remain selectable independently.
    /// </summary>
    [DefaultExecutionOrder(-50)]
    [RequireComponent(typeof(Rigidbody), typeof(CapsuleCollider))]
    public sealed class GymMotor : MonoBehaviour
    {
        public GymRigInput input;
        public GymHand leftHand, rightHand;
        public LayerMask worldLayers;
        public LocomotionController mode = LocomotionController.ForceServo;
        public float handRadius = 0.07f;
        public float maxAcceleration = 60f;
        public float contactResponse = 28f;
        public float contactCorrection = 18f;
        public float maximumHandSeparation = 0.65f;
        public float desktopWalkSpeed = 2f;
        public bool motorEnabled = true;
        [Header("Cast correction teaching mode")]
        public bool preserveExternalVelocity = true;
        public float maximumCorrectionPerStep = 0.15f;
        public float headRadius = 0.12f;
        public float skin = 0.003f;
        public float minimumLaunchSpeed = 0.35f;
        public float maximumLaunchSpeed = 7f;
        public float launchMultiplier = 1f;
        public float releaseMemorySeconds = 0.08f;
        public bool LeftContact => states[0].planted;
        public bool RightContact => states[1].planted;
        public Vector3 LastCorrection { get; private set; }
        public string ActiveMode => motorEnabled ? mode.ToString() : "Off";

        struct ContactState
        {
            public bool initialized, planted;
            public Vector3 previous, anchor, normal, localAnchor, localNormal, supportVelocity;
            public Collider surface;
            public Rigidbody support;
        }
        readonly ContactState[] states = new ContactState[2];
        readonly Collider[] overlaps = new Collider[32];
        Rigidbody body;
        CapsuleCollider capsule;
        SphereCollider headProbe;
        Vector3 lastStroke, lastSupportVelocity;
        float lastStrokeTime = float.NegativeInfinity;
        int previousContactCount;
        LocomotionController previousMode;

        void Awake()
        {
            body = GetComponent<Rigidbody>(); capsule = GetComponent<CapsuleCollider>();
            // Disabled geometry is used only by ComputePenetration, not by the solver.
            headProbe = gameObject.AddComponent<SphereCollider>();
            headProbe.enabled = false; headProbe.radius = headRadius;
            previousMode = mode;
        }

        void FixedUpdate()
        {
            if (input == null || input.head == null || leftHand == null || rightHand == null) return;
            Vector3 headLocal = transform.InverseTransformPoint(input.head.position);
            capsule.height = Mathf.Clamp(headLocal.y, 0.65f, 2.4f);
            capsule.center = new Vector3(headLocal.x, capsule.height * 0.5f + 0.02f, headLocal.z);
            LastCorrection = Vector3.zero;
            if (mode != previousMode) { ResetContacts(); previousMode = mode; }
            if (!motorEnabled || mode == LocomotionController.Off) { ResetContacts(); return; }

            if (mode == LocomotionController.CastCorrection)
            {
                Vector3 recovery = RecoverOverlap(body.position, headLocal) - body.position;
                if (recovery.sqrMagnitude > 1e-8f)
                {
                    body.position += recovery;
                    // Tracking/penetration recovery is never measured as a launch stroke.
                    ResetContacts();
                }
            }

            Vector3 desiredSum = Vector3.zero, correctionSum = Vector3.zero;
            Vector3 strokeSum = Vector3.zero, supportSum = Vector3.zero;
            int count = 0;
            bool naturalRelease = false;
            UpdateHand(leftHand, 0, ref desiredSum, ref correctionSum, ref strokeSum, ref supportSum, ref count, ref naturalRelease);
            UpdateHand(rightHand, 1, ref desiredSum, ref correctionSum, ref strokeSum, ref supportSum, ref count, ref naturalRelease);
            if (count > 0)
            {
                if (mode == LocomotionController.ForceServo)
                {
                    Vector3 desiredVelocity = Vector3.ClampMagnitude(desiredSum / count, 8f);
                    Vector3 acceleration = (desiredVelocity - body.linearVelocity) * contactResponse - Physics.gravity;
                    body.AddForce(Vector3.ClampMagnitude(acceleration, maxAcceleration), ForceMode.Acceleration);
                }
                else
                {
                    // Two hands share a correction. Adding them would double an
                    // identical stroke and make grip count change locomotion strength.
                    Vector3 requested = Vector3.ClampMagnitude(correctionSum / count, maximumCorrectionPerStep);
                    LastCorrection = SweepCorrection(body.position, requested, headLocal);
                    body.position += LastCorrection;
                    Vector3 velocity = preserveExternalVelocity ? body.linearVelocity : Vector3.zero;
                    for (int i = 0; i < states.Length; i++)
                        if (states[i].planted)
                            velocity = GymControllerMath.RemoveInwardVelocity(velocity,
                                states[i].supportVelocity, states[i].normal);
                    body.linearVelocity = velocity;
                    // Use actual local tracking motion, not body corrections, gravity,
                    // platform displacement, or penetration recovery, for push-off.
                    Vector3 stroke = Vector3.ClampMagnitude(strokeSum / count * launchMultiplier, maximumLaunchSpeed);
                    Vector3 normalSum = Vector3.zero;
                    for (int i = 0; i < states.Length; i++) if (states[i].planted) normalSum += states[i].normal;
                    // Retain a recent pushing/tangential stroke while the hand lifts
                    // away; lifting out of the floor must not become a downward launch.
                    if (stroke.magnitude >= minimumLaunchSpeed && Vector3.Dot(stroke, normalSum) >= -0.001f)
                    { lastStroke = stroke; lastStrokeTime = Time.fixedTime; }
                    lastSupportVelocity = supportSum / count;
                }
            }
            else
            {
                if (mode == LocomotionController.CastCorrection && previousContactCount > 0 && naturalRelease
                    && lastStroke.magnitude >= minimumLaunchSpeed
                    && Time.fixedTime - lastStrokeTime <= releaseMemorySeconds)
                {
                    // Preserve mode adds only the stroke. Existing world velocity may
                    // already include a support's motion, so do not add it a second time.
                    body.linearVelocity = preserveExternalVelocity ? body.linearVelocity + lastStroke
                        : lastSupportVelocity + lastStroke;
                }
                lastStroke = lastSupportVelocity = Vector3.zero;
                lastStrokeTime = float.NegativeInfinity;
                if (!input.IsXR && input.Walk.sqrMagnitude > 0f) DesktopWalk();
            }
            previousContactCount = count;
        }

        void DesktopWalk()
        {
            Vector3 forward = Vector3.ProjectOnPlane(input.head.forward, Vector3.up).normalized;
            Vector3 right = Vector3.Cross(Vector3.up, forward);
            Vector3 desired = (forward * input.Walk.y + right * input.Walk.x) * desktopWalkSpeed;
            Vector3 horizontal = Vector3.ProjectOnPlane(body.linearVelocity, Vector3.up);
            body.AddForce(Vector3.ClampMagnitude((desired - horizontal) * 12f, 20f), ForceMode.Acceleration);
        }

        void UpdateHand(GymHand hand, int index, ref Vector3 desiredSum, ref Vector3 correctionSum,
            ref Vector3 strokeSum, ref Vector3 supportSum, ref int count, ref bool naturalRelease)
        {
            ContactState s = states[index];
            Vector3 raw = hand.TargetPosition;
            if (hand.Held != null || !hand.Valid)
            {
                s = new ContactState(); hand.HasSurfaceContact = false; states[index] = s; return;
            }
            if (!s.initialized) { s.previous = raw; s.initialized = true; }
            if (s.planted)
            {
                if (s.surface == null || !s.surface.enabled || !s.surface.gameObject.activeInHierarchy) s.planted = false;
                else
                {
                    RefreshSupport(ref s);
                    if (Vector3.Dot(raw - s.anchor, s.normal) > 0.045f
                        || (raw - s.anchor).magnitude > maximumHandSeparation)
                    { s.planted = false; naturalRelease = true; }
                }
            }
            if (!s.planted)
            {
                Vector3 travel = raw - s.previous;
                float distance = travel.magnitude;
                if (distance > 0.0001f && Physics.SphereCast(s.previous, handRadius, travel / distance,
                    out RaycastHit hit, distance + skin, worldLayers, QueryTriggerInteraction.Ignore)) Plant(ref s, hit);
                else if (Physics.SphereCast(raw + Vector3.up * 0.025f, handRadius,
                    Vector3.down, out hit, 0.035f, worldLayers, QueryTriggerInteraction.Ignore)) Plant(ref s, hit);
            }

            hand.HasSurfaceContact = s.planted;
            if (s.planted)
            {
                hand.SurfaceContactPosition = s.anchor;
                Vector3 trackedVelocity = input.trackingSpace.TransformDirection(hand.LocalVelocity);
                Vector3 correction = s.anchor - raw;
                desiredSum += s.supportVelocity - trackedVelocity + correction * contactCorrection;
                correctionSum += correction;
                strokeSum -= trackedVelocity;
                supportSum += s.supportVelocity;
                count++;
                s.previous = s.anchor;
            }
            else s.previous = raw;
            states[index] = s;
        }

        void Plant(ref ContactState s, RaycastHit hit)
        {
            s.planted = true; s.surface = hit.collider; s.support = hit.rigidbody;
            s.normal = hit.normal;
            s.anchor = hit.point + hit.normal * (handRadius + skin);
            if (s.support != null)
            {
                s.localAnchor = Quaternion.Inverse(s.support.rotation) * (s.anchor - s.support.position);
                s.localNormal = Quaternion.Inverse(s.support.rotation) * s.normal;
            }
            else
            {
                s.localAnchor = s.surface.transform.InverseTransformPoint(s.anchor);
                s.localNormal = s.surface.transform.InverseTransformDirection(s.normal);
            }
            RefreshSupport(ref s);
        }

        void RefreshSupport(ref ContactState s)
        {
            if (s.support != null)
            {
                s.anchor = s.support.position + s.support.rotation * s.localAnchor;
                s.normal = (s.support.rotation * s.localNormal).normalized;
                s.supportVelocity = s.support.GetPointVelocity(s.anchor);
            }
            else
            {
                s.anchor = s.surface.transform.TransformPoint(s.localAnchor);
                s.normal = s.surface.transform.TransformDirection(s.localNormal).normalized;
                s.supportVelocity = Vector3.zero;
            }
        }

        void CapsulePoints(Vector3 position, out Vector3 bottom, out Vector3 top)
        {
            Vector3 centre = position + body.rotation * capsule.center;
            Vector3 half = body.rotation * Vector3.up * Mathf.Max(0f, capsule.height * 0.5f - capsule.radius);
            bottom = centre - half; top = centre + half;
        }

        Vector3 SweepCorrection(Vector3 start, Vector3 movement, Vector3 headLocal)
        {
            Vector3 position = start;
            for (int iteration = 0; iteration < 3 && movement.sqrMagnitude > 1e-8f; iteration++)
            {
                float length = movement.magnitude;
                Vector3 direction = movement / length;
                CapsulePoints(position, out Vector3 bottom, out Vector3 top);
                bool blocked = Physics.CapsuleCast(bottom, top, capsule.radius, direction, out RaycastHit closest,
                    length + skin, worldLayers, QueryTriggerInteraction.Ignore);
                if (Physics.SphereCast(position + body.rotation * headLocal, headRadius, direction, out RaycastHit headHit,
                    length + skin, worldLayers, QueryTriggerInteraction.Ignore) && (!blocked || headHit.distance < closest.distance))
                { closest = headHit; blocked = true; }
                if (!blocked) { position += movement; break; }
                float travel = Mathf.Clamp(closest.distance - skin, 0f, length);
                position += direction * travel;
                movement = Vector3.ProjectOnPlane(movement - direction * travel, closest.normal);
            }
            return position - start;
        }

        Vector3 RecoverOverlap(Vector3 start, Vector3 headLocal)
        {
            Vector3 position = start;
            headProbe.radius = headRadius;
            for (int iteration = 0; iteration < 3; iteration++)
            {
                CapsulePoints(position, out Vector3 bottom, out Vector3 top);
                int count = Physics.OverlapCapsuleNonAlloc(bottom, top, capsule.radius,
                    overlaps, worldLayers, QueryTriggerInteraction.Ignore);
                bool moved = ResolveOverlaps(capsule, ref position, start, Vector3.zero, count);
                count = Physics.OverlapSphereNonAlloc(position + body.rotation * headLocal, headRadius,
                    overlaps, worldLayers, QueryTriggerInteraction.Ignore);
                moved |= ResolveOverlaps(headProbe, ref position, start, body.rotation * headLocal, count);
                if (!moved || (position - start).magnitude >= maximumCorrectionPerStep) break;
            }
            return position;
        }

        bool ResolveOverlaps(Collider shape, ref Vector3 position, Vector3 start, Vector3 offset, int count)
        {
            bool moved = false;
            for (int i = 0; i < count; i++)
            {
                Collider other = overlaps[i];
                if (other == null || other.attachedRigidbody == body) continue;
                Vector3 otherPosition = other.transform.position;
                Quaternion otherRotation = other.transform.rotation;
                Rigidbody owner = other.attachedRigidbody;
                if (owner != null)
                {
                    otherPosition = owner.position + owner.rotation * owner.transform.InverseTransformPoint(otherPosition);
                    otherRotation = owner.rotation * Quaternion.Inverse(owner.transform.rotation) * otherRotation;
                }
                if (Physics.ComputePenetration(shape, position + offset, body.rotation, other, otherPosition, otherRotation,
                    out Vector3 direction, out float distance) && distance > skin)
                {
                    Vector3 candidate = position + direction * (distance + skin);
                    position = start + Vector3.ClampMagnitude(candidate - start, maximumCorrectionPerStep);
                    moved = true;
                }
            }
            return moved;
        }

        public void CycleMode() { mode = (LocomotionController)(((int)mode + 1) % 3); ResetContacts(); }
        public void ResetContacts()
        {
            states[0] = new ContactState(); states[1] = new ContactState();
            previousContactCount = 0; lastStroke = lastSupportVelocity = Vector3.zero;
            lastStrokeTime = float.NegativeInfinity;
            if (leftHand != null) leftHand.HasSurfaceContact = false;
            if (rightHand != null) rightHand.HasSurfaceContact = false;
        }
        void OnDestroy() { if (headProbe != null) Destroy(headProbe); }
    }
}
