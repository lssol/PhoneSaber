# PhoneSaber

POC that turns a phone into a lightsaber. Phone IMU drives the saber's orientation; webcam + MediaPipe Pose drives its position. Strong priors (two-handed grip, user staying near the computer) let us solve the phone's pose from wrist positions instead of integrating accelerometer drift.

## Architecture

```
phone (Expo)  ──ws──>  server (relay)  ──ws──>  client (three.js viewer)
                                                    │
                                                    └──webcam──> MediaPipe Pose
```

- `protocol/` — TypeScript types + encode/decode for the wire format. Source of truth for server and client (npm workspace dep `@phonesaber/protocol`). Phone duplicates this file (see "Phone" below).
- `server/` — TypeScript WebSocket relay (`tsx --watch`) on `0.0.0.0:8080`. Validates each frame with `decode()` before fanning out to the other connected clients. Drops anything that doesn't parse.
- `client/` — Vite + TypeScript + three.js viewer. Modules: `scene.ts` (three.js setup + saber load), `sensors.ts` (WebSocket → typed frames), `vision.ts` (webcam + MediaPipe Pose → body landmarks), `fusion.ts` (calibration + position solver), `filter.ts` (One-Euro), `main.ts` (orchestrator).
- `phone/` — Expo SDK 52 + TypeScript. Streams the OS-fused rotation quaternion and linear acceleration over WebSocket, plus a `cal` frame on volume-down. **Not part of the npm workspace** — Metro's resolver doesn't play nicely with hoisted node_modules, so phone keeps its own deps and a duplicated copy of `protocol.ts`.

## Wire protocol

CSV strings, one per WebSocket message. Sensor-type prefixes match the Android `Sensor.TYPE_*` constants the original phone client used (preserved for stability — no other meaning is implied):

| Tag | Frame              | Format                   |
|-----|--------------------|--------------------------|
| 15  | rotation quaternion| `15,t,x,y,z,w`           |
| 10  | linear acceleration| `10,t,x,y,z` (m/s²)      |
| cal | calibrate trigger  | `cal,t`                  |

`t` is a nanosecond timestamp from the platform sensor stack. Acceleration is currently ignored by the client (vision provides position).

Defined in `protocol/src/index.ts` (and mirrored in `phone/protocol.ts`).

## Running it

From the repo root:

```bash
npm install               # installs root + protocol + server + client workspaces
npm --prefix phone install  # phone, separately

npm run dev               # runs server (:8080), client (:3000), Metro (:8081) in parallel
```

Individual scripts: `npm run server`, `npm run client`, `npm run phone`. Open http://localhost:3000 for the viewer.

`npm run typecheck` runs `tsc --noEmit` across all four packages.

## Client behavior

Sensor split: **IMU does orientation, vision does position.** No double-integration of accelerometer.

- **Orientation**: from the phone IMU. Displayed orientation is `imuNeutral⁻¹ · imuCurrent`, so the saber sits at rest in the calibration pose. Computed in `Fusion.updateOrientation`.
- **Position**: from MediaPipe Pose `worldLandmarks` (metres, hip-centre origin). The two-handed grip means both wrists co-locate the phone — we take their midpoint, re-express in shoulder-centred coordinates, clamp inside the calibrated arm-reach sphere, smooth with One-Euro. Computed in `Fusion.updatePosition`. If both wrists drop below visibility threshold the previous position is held.
- **Coordinate frames**: MediaPipe world frame (+X subject-left, +Y down, +Z away-from-camera) → three.js scene frame (+X right, +Y up, +Z toward camera) by negating all three axes (the X negation also mirrors movement to match the horizontally-flipped video preview).
- **Calibration**: triggered by phone volume-down (`cal` frame over WebSocket) or by pressing `c`/`Space` in the viewer. Snapshots the current IMU quaternion as the rest pose and the current shoulder→wrist distance as the reach clamp.
- **Asset path**: GLB lives in `client/public/lightsaber.glb` and is served at `/lightsaber.glb`.
- **WS URL**: derived from `location.hostname`, so opening the viewer via LAN IP automatically points the WS at the same host on `:8080`.
- **Audio** (`client/src/audio.ts`): hum loop + swing whoosh via Web Audio. Calibration (spacebar / `c` / phone volume-down) doubles as the user-gesture that unlocks the AudioContext and starts the hum. Swings are triggered from linear-accel magnitude with a cooldown; gain and pitch scale with intensity. Assets in `client/public/sounds/` are CC0 from opengameart.org (`light_sabre1` and the `swishes` pack).
- **Camera permission**: the viewer prompts for webcam access on load (`navigator.mediaDevices.getUserMedia`). MediaPipe Pose runs in-browser on the WASM runtime fetched from jsDelivr; the model `.task` file is fetched from Google's MediaPipe model CDN. Both can be self-hosted later if offline use is needed.

## Phone

Expo SDK 52, TypeScript (`App.tsx`). Single screen: server URL + Start/Stop + status/rate readout.

### Sensor source — local Expo native module

`expo-sensors`' `DeviceMotion` only exposes Euler angles, which throws away the OS-fused quaternion. We bypass it with `phone/modules/sensor-fusion/`, a local Expo Module:

- **Android** (`SensorFusionModule.kt`): `Sensor.TYPE_GAME_ROTATION_VECTOR` preferred (gyro + accel only, no magnetometer drift), falls back to `Sensor.TYPE_ROTATION_VECTOR`. `SensorManager.getQuaternionFromVector` converts the rotation-vector representation to a quaternion. Linear accel from `Sensor.TYPE_LINEAR_ACCELERATION` (m/s², gravity removed).
- **iOS** (`SensorFusionModule.swift`): `CMMotionManager.startDeviceMotionUpdates(using: .xArbitraryCorrectedZVertical)` → `CMAttitude.quaternion` and `CMDeviceMotion.userAcceleration` (multiplied by 9.81 to match Android m/s²).

JS side (`modules/sensor-fusion/index.ts`) exposes `start`, `stop`, `onRotation`, `onAcceleration`, `onCalibrate`. The module subclasses `NativeModule<SensorFusionEvents>` so the listener signatures are type-checked.

### Volume-down calibration trigger

The hardware volume-down button fires `onCalibrate` (which `App.tsx` forwards as a `cal` frame over WebSocket). Volume-up is left alone.

- **Android**: `MainActivity.onKeyDown` intercepts `KEYCODE_VOLUME_DOWN` and calls `SensorFusionModule.calibrationTrigger`, a process-wide singleton the module installs in `OnCreate`. The event is consumed so the system volume UI doesn't show up. **MainActivity.kt was modified by hand** and is not re-generated; if you re-run `expo prebuild --clean`, re-apply the volume-down hook.
- **iOS**: KVO on `AVAudioSession.outputVolume`. A 1×1 off-screen `MPVolumeView` suppresses the system volume HUD. After every press we restore the volume to a baseline so subsequent presses still register even if iOS pinned us at 0 or 1. We ignore volume-up by only firing when the new value is below the old.

### Dev build required (not Expo Go)

Because of the local native module, Expo Go cannot run this app. Use EAS Build:

```bash
cd phone
npx eas-cli build --platform android --profile development --non-interactive
```

EAS produces an installable APK (dev-client) — sideload it onto the phone. Subsequent JS-only iteration: `npm run phone` (Metro), edits hot-reload. **Rebuild only when**:
- a native dep is added (e.g. `expo-asset`, which was missed on the first build and silently crashed the app — see commit history)
- Kotlin/Swift in `modules/sensor-fusion` changes
- `app.json` permissions/config change

### Axis-frame caveat

Android `TYPE_GAME_ROTATION_VECTOR` and iOS `.xArbitraryCorrectedZVertical` use different reference frames. The calibration step on the viewer absorbs the resting-pose offset, but mid-motion axes won't perfectly correspond between platforms. If this becomes a problem, normalize in the native modules before emitting.

## Things explicitly not done

- No tests. The whole thing fits comfortably in one head.
- No CI.
- No yaw-drift correction from vision. The wrist-to-wrist vector could be used as a slow correction on IMU yaw (the one axis IMU fusion can't fix without a magnetometer), but isn't yet — see the design notes for the planned approach.
- No full constrained least-squares solver. v1 takes the wrist midpoint directly; the over-determined IMU + two-wrist + reach formulation is reserved for if/when the simple approach feels insufficient.
