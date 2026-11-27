using System.Collections.Generic;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.XR;

namespace Tront.PhysicsGym
{
    [DefaultExecutionOrder(-300)]
    public sealed class GymRigInput : MonoBehaviour
    {
        public InputActionAsset actions;
        public Transform trackingSpace, head, leftTarget, rightTarget;
        public bool useXRWhenAvailable = true;
        [Tooltip("Leave zero with a Floor tracking origin. Set eye height only for Device origin.")]
        public float deviceOriginHeightOffset;
        public float desktopEyeHeight = 1.65f;
        public bool IsXR { get; private set; }
        public bool LeftValid { get; private set; } = true;
        public bool RightValid { get; private set; } = true;
        public bool LeftGrip { get; private set; }
        public bool RightGrip { get; private set; }
        public bool CyclePressed { get; private set; }
        public bool FeedForwardPressed { get; private set; }
        public bool ResetPressed { get; private set; }
        public bool LocomotionPressed { get; private set; }
        public Vector2 Walk { get; private set; }
        public Vector3 LeftLocalVelocity { get; private set; }
        public Vector3 RightLocalVelocity { get; private set; }
        public Vector3 LeftLocalAngularVelocity { get; private set; }
        public Vector3 RightLocalAngularVelocity { get; private set; }
        public Vector3 LeftLocalAcceleration { get; private set; }
        public Vector3 RightLocalAcceleration { get; private set; }
        public event System.Action OriginChanged;

        InputAction hp, hr, ht, lp, lr, lt, lg, rp, rr, rt, rg, cycle, ff, reset, walk, locomotion;
        Vector3 desktopLeft = new Vector3(-0.28f, 1.15f, 0.5f);
        Vector3 desktopRight = new Vector3(0.28f, 1.15f, 0.5f);
        Vector3 previousLeft, previousRight;
        Quaternion previousLeftRotation, previousRightRotation;
        float yaw, pitch;
        int selectedHands = 3;
        bool poseHistoryReady, originRequested;
        readonly List<XRInputSubsystem> subsystems = new List<XRInputSubsystem>();
        XRInputSubsystem subscribedSubsystem;

        void Awake()
        {
            if (actions == null) { Debug.LogError("Run the Physics Gym scene builder to create its input asset.", this); enabled = false; return; }
            hp = actions.FindAction("HeadPosition", true); hr = actions.FindAction("HeadRotation", true);
            ht = actions.FindAction("HeadTracked", true);
            lp = actions.FindAction("LeftPosition", true); lr = actions.FindAction("LeftRotation", true);
            lt = actions.FindAction("LeftTracked", true); lg = actions.FindAction("LeftGrip", true);
            rp = actions.FindAction("RightPosition", true); rr = actions.FindAction("RightRotation", true);
            rt = actions.FindAction("RightTracked", true); rg = actions.FindAction("RightGrip", true);
            cycle = actions.FindAction("CycleController", true); ff = actions.FindAction("ToggleFeedForward", true);
            reset = actions.FindAction("Reset", true); walk = actions.FindAction("Walk", true);
            // Optional for older generated assets. Regenerate the teaching scene to
            // include N / right-secondary-button bindings without editing at runtime.
            locomotion = actions.FindAction("CycleLocomotion", false);
        }

        void OnEnable()
        {
            if (actions != null) actions.Enable();
            Application.onBeforeRender += BeforeRender;
        }
        void OnDisable()
        {
            Application.onBeforeRender -= BeforeRender;
            if (actions != null) actions.Disable();
            if (subscribedSubsystem != null) subscribedSubsystem.trackingOriginUpdated -= OnTrackingOriginUpdated;
            subscribedSubsystem = null;
            Cursor.lockState = CursorLockMode.None;
        }

        void Update()
        {
            bool newXR = useXRWhenAvailable && XRSettings.isDeviceActive;
            if (newXR != IsXR) { ResetDerivatives(); originRequested = false; OriginChanged?.Invoke(); }
            IsXR = newXR;
            if (IsXR && !originRequested)
            {
                SubsystemManager.GetSubsystems(subsystems);
                foreach (XRInputSubsystem subsystem in subsystems)
                    if (subsystem.running)
                    {
                        if (subscribedSubsystem != subsystem)
                        {
                            if (subscribedSubsystem != null) subscribedSubsystem.trackingOriginUpdated -= OnTrackingOriginUpdated;
                            subscribedSubsystem = subsystem;
                            subsystem.trackingOriginUpdated += OnTrackingOriginUpdated;
                        }
                        bool floorSupported = subsystem.TrySetTrackingOriginMode(TrackingOriginModeFlags.Floor);
                        originRequested = true;
                        if (!floorSupported) Debug.LogWarning("Floor tracking origin unavailable. Set GymRigInput.deviceOriginHeightOffset for Device origin.", this);
                    }
            }
            CyclePressed = cycle.WasPressedThisFrame();
            FeedForwardPressed = ff.WasPressedThisFrame();
            ResetPressed = reset.WasPressedThisFrame();
            LocomotionPressed = locomotion != null && locomotion.WasPressedThisFrame();
            if (IsXR)
            {
                ReadXRPose();
                LeftGrip = LeftValid && lg.ReadValue<float>() > 0.55f;
                RightGrip = RightValid && rg.ReadValue<float>() > 0.55f;
                Walk = Vector2.zero; // Arm locomotion; no accidental joystick movement in VR.
            }
            else ReadDesktop();
            UpdateDerivatives();
        }

        void ReadXRPose()
        {
            bool headValid = ht.ReadValue<float>() > 0.5f;
            LeftValid = headValid && lt.ReadValue<float>() > 0.5f;
            RightValid = headValid && rt.ReadValue<float>() > 0.5f;
            Vector3 offset = Vector3.up * deviceOriginHeightOffset;
            if (headValid) { head.localPosition = hp.ReadValue<Vector3>() + offset; head.localRotation = hr.ReadValue<Quaternion>(); }
            if (LeftValid) { leftTarget.localPosition = lp.ReadValue<Vector3>() + offset; leftTarget.localRotation = lr.ReadValue<Quaternion>(); }
            if (RightValid) { rightTarget.localPosition = rp.ReadValue<Vector3>() + offset; rightTarget.localRotation = rr.ReadValue<Quaternion>(); }
        }

        void BeforeRender()
        {
            // Late HMD pose only. Physics targets/derivatives are sampled consistently in Update.
            if (IsXR && ht != null && ht.ReadValue<float>() > 0.5f)
            { head.localPosition = hp.ReadValue<Vector3>() + Vector3.up * deviceOriginHeightOffset; head.localRotation = hr.ReadValue<Quaternion>(); }
        }

        void ReadDesktop()
        {
            LeftValid = RightValid = true;
            Keyboard keyboard = Keyboard.current;
            Mouse mouse = Mouse.current;
            Walk = Vector2.ClampMagnitude(walk.ReadValue<Vector2>(), 1f);
            if (mouse != null && mouse.rightButton.isPressed)
            {
                Vector2 delta = mouse.delta.ReadValue();
                yaw += delta.x * 0.13f; pitch = Mathf.Clamp(pitch - delta.y * 0.13f, -80f, 80f);
                Cursor.lockState = CursorLockMode.Locked;
            }
            else Cursor.lockState = CursorLockMode.None;
            if (keyboard != null)
            {
                if (keyboard.digit1Key.wasPressedThisFrame) selectedHands = 1;
                if (keyboard.digit2Key.wasPressedThisFrame) selectedHands = 2;
                if (keyboard.digit3Key.wasPressedThisFrame) selectedHands = 3;
                Vector3 change = new Vector3(
                    (keyboard.lKey.isPressed ? 1 : 0) - (keyboard.jKey.isPressed ? 1 : 0),
                    (keyboard.uKey.isPressed ? 1 : 0) - (keyboard.oKey.isPressed ? 1 : 0),
                    (keyboard.iKey.isPressed ? 1 : 0) - (keyboard.kKey.isPressed ? 1 : 0)) * (0.85f * Time.unscaledDeltaTime);
                if ((selectedHands & 1) != 0) desktopLeft += change;
                if ((selectedHands & 2) != 0) desktopRight += change;
                desktopLeft = ClampDesktopHand(desktopLeft); desktopRight = ClampDesktopHand(desktopRight);
                LeftGrip = keyboard.qKey.isPressed; RightGrip = keyboard.eKey.isPressed;
                if (keyboard.hKey.wasPressedThisFrame) ResetDesktopHands();
            }
            head.localPosition = Vector3.up * desktopEyeHeight;
            head.localRotation = Quaternion.Euler(pitch, yaw, 0f);
            Quaternion flat = Quaternion.Euler(0f, yaw, 0f);
            leftTarget.localPosition = flat * desktopLeft; rightTarget.localPosition = flat * desktopRight;
            leftTarget.localRotation = rightTarget.localRotation = flat;
        }

        Vector3 ClampDesktopHand(Vector3 hand)
        {
            Vector3 shoulder = Vector3.up * (desktopEyeHeight - 0.2f);
            return shoulder + Vector3.ClampMagnitude(hand - shoulder, 1.6f);
        }

        void UpdateDerivatives()
        {
            float dt = Mathf.Max(0.001f, Time.unscaledDeltaTime);
            bool jumped = poseHistoryReady && ((leftTarget.localPosition - previousLeft).sqrMagnitude > 0.25f
                || (rightTarget.localPosition - previousRight).sqrMagnitude > 0.25f);
            bool discontinuity = !poseHistoryReady || !LeftValid || !RightValid || jumped;
            if (discontinuity)
            {
                LeftLocalVelocity = RightLocalVelocity = Vector3.zero;
                LeftLocalAngularVelocity = RightLocalAngularVelocity = Vector3.zero;
                LeftLocalAcceleration = RightLocalAcceleration = Vector3.zero;
                if (jumped) OriginChanged?.Invoke();
            }
            else
            {
                float blend = 1f - Mathf.Exp(-2f * Mathf.PI * 20f * dt);
                Vector3 oldLeft = LeftLocalVelocity, oldRight = RightLocalVelocity;
                LeftLocalVelocity = Vector3.Lerp(LeftLocalVelocity, Vector3.ClampMagnitude((leftTarget.localPosition - previousLeft) / dt, 10f), blend);
                RightLocalVelocity = Vector3.Lerp(RightLocalVelocity, Vector3.ClampMagnitude((rightTarget.localPosition - previousRight) / dt, 10f), blend);
                float accelerationBlend = 1f - Mathf.Exp(-2f * Mathf.PI * 12f * dt);
                LeftLocalAcceleration = Vector3.Lerp(LeftLocalAcceleration,
                    Vector3.ClampMagnitude((LeftLocalVelocity - oldLeft) / dt, 35f), accelerationBlend);
                RightLocalAcceleration = Vector3.Lerp(RightLocalAcceleration,
                    Vector3.ClampMagnitude((RightLocalVelocity - oldRight) / dt, 35f), accelerationBlend);
                LeftLocalAngularVelocity = Vector3.ClampMagnitude(GymControllerMath.RotationVector(leftTarget.localRotation, previousLeftRotation) / dt, 25f);
                RightLocalAngularVelocity = Vector3.ClampMagnitude(GymControllerMath.RotationVector(rightTarget.localRotation, previousRightRotation) / dt, 25f);
            }
            previousLeft = leftTarget.localPosition; previousRight = rightTarget.localPosition;
            previousLeftRotation = leftTarget.localRotation; previousRightRotation = rightTarget.localRotation;
            poseHistoryReady = LeftValid && RightValid;
        }

        public void ResetDerivatives()
        {
            poseHistoryReady = false;
            LeftLocalVelocity = RightLocalVelocity = Vector3.zero;
            LeftLocalAngularVelocity = RightLocalAngularVelocity = Vector3.zero;
            LeftLocalAcceleration = RightLocalAcceleration = Vector3.zero;
        }
        void OnTrackingOriginUpdated(XRInputSubsystem subsystem) { ResetDerivatives(); OriginChanged?.Invoke(); }
        public void ResetDesktopHands() { desktopLeft = new Vector3(-0.28f, 1.15f, 0.5f); desktopRight = new Vector3(0.28f, 1.15f, 0.5f); ResetDerivatives(); }
    }
}
