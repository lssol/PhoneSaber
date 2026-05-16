# PhoneSaber

POC that turns a phone into a lightsaber: phone sensors drive a 3D saber rendered in three.js. Rotations work well; translations are noisy without visual fusion and are not currently applied.

## Architecture

```
phone (Expo)  --ws-->  server (relay)  --ws-->  client (three.js viewer)
```

- `protocol/` — TypeScript types + encode/decode for the wire format. Source of truth for server and client (npm workspace dep `@phonesaber/protocol`). Phone duplicates this file (see "Phone" below).
- `server/` — TypeScript WebSocket relay (`tsx --watch`) on `0.0.0.0:8080`. Validates each frame with `decode()` before fanning out to the other connected clients. Drops anything that doesn't parse.
- `client/` — Vite + TypeScript + three.js viewer. Loads `public/lightsaber.glb`, applies received quaternions to the saber mesh, HUD overlay shows connection state + msg/s.
- `phone/` — Expo SDK 52 + TypeScript. Streams the OS-fused rotation quaternion and linear acceleration over WebSocket. **Not part of the npm workspace** — Metro's resolver doesn't play nicely with hoisted node_modules, so phone keeps its own deps and a duplicated copy of `protocol.ts`.

## Wire protocol

CSV strings, one per WebSocket message. Sensor-type prefixes match the Android `Sensor.TYPE_*` constants the original phone client used (preserved for stability — no other meaning is implied):

| ID | Frame              | Format                   |
|----|--------------------|--------------------------|
| 15 | rotation quaternion| `15,t,x,y,z,w`           |
| 10 | linear acceleration| `10,t,x,y,z` (m/s²)      |

`t` is a nanosecond timestamp from the platform sensor stack.

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

- **Rotation**: phone quaternion is stored in `phoneRotation`; displayed orientation is `calibration⁻¹ · phoneRotation`. Press **space** to set `calibration` to the current pose — the saber then sits at rest in that pose.
- **Translation**: not applied. The old double-integration + position-dependent friction code in `client/src/index.js` was deleted in the TS rewrite; it never produced usable results without visual fusion.
- **Asset path**: GLB lives in `client/public/lightsaber.glb` and is served at `/lightsaber.glb`.
- **WS URL**: derived from `location.hostname`, so opening the viewer via LAN IP automatically points the WS at the same host on `:8080`.

## Phone

Expo SDK 52, TypeScript (`App.tsx`). Single screen: server URL + Start/Stop + status/rate readout.

### Sensor source — local Expo native module

`expo-sensors`' `DeviceMotion` only exposes Euler angles, which throws away the OS-fused quaternion. We bypass it with `phone/modules/sensor-fusion/`, a local Expo Module:

- **Android** (`SensorFusionModule.kt`): `Sensor.TYPE_GAME_ROTATION_VECTOR` preferred (gyro + accel only, no magnetometer drift), falls back to `Sensor.TYPE_ROTATION_VECTOR`. `SensorManager.getQuaternionFromVector` converts the rotation-vector representation to a quaternion. Linear accel from `Sensor.TYPE_LINEAR_ACCELERATION` (m/s², gravity removed).
- **iOS** (`SensorFusionModule.swift`): `CMMotionManager.startDeviceMotionUpdates(using: .xArbitraryCorrectedZVertical)` → `CMAttitude.quaternion` and `CMDeviceMotion.userAcceleration` (multiplied by 9.81 to match Android m/s²).

JS side (`modules/sensor-fusion/index.ts`) exposes `start`, `stop`, `onRotation`, `onAcceleration`. The module subclasses `NativeModule<SensorFusionEvents>` so the listener signatures are type-checked.

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

Android `TYPE_GAME_ROTATION_VECTOR` and iOS `.xArbitraryCorrectedZVertical` use different reference frames. The spacebar calibration on the viewer absorbs the resting-pose offset, but mid-motion axes won't perfectly correspond between platforms. If this becomes a problem, normalize in the native modules before emitting.

## Things explicitly not done

- No tests. The whole thing fits comfortably in one head.
- No CI.
- Position integration is gone. If you want it back, you'll want some form of ZUPT or visual-inertial fusion rather than the raw double-integral the original POC tried.
