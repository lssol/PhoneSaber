# PhoneSaber

POC that turns a phone into a lightsaber: phone sensors drive a 3D saber rendered in three.js. Rotations work well; translations are noisy without visual fusion.

## Architecture

```
phone (Expo app) --ws--> server (relay) --ws--> client (three.js viewer)
```

- `phone/` — React Native + Expo app. Streams the OS-fused rotation quaternion and linear acceleration over a WebSocket connection to `server/`. See "Phone app" below.
- `server/` — WebSocket relay on `0.0.0.0:8080`. Forwards every message from one connected client to all others. No state, no routing — just a fan-out. Uses `ws` (not yet listed in `package.json`).
- `client/` — Browser page. Loads `res/l2/lightsaber.glb` via `THREE.GLTFLoader`, connects to `ws://localhost:8080`, applies received sensor frames to the saber mesh.

## Wire protocol

Messages are CSV strings: `sensorType,timestamp,x,y,z[,w]`. The sensor-type IDs match Android `Sensor.TYPE_*` constants:

| ID | Meaning            | Fields used                                  |
|----|--------------------|----------------------------------------------|
| 15 | Rotation vector    | `values[2..5]` → quaternion `x, y, z, w`     |
| 10 | Linear acceleration| `values[1]` timestamp, `values[2..4]` → x,y,z|

The client (`client/src/index.js`) ignores anything else.

## Client behavior

- **Rotation**: quaternion received from sensor 15 is applied each frame; spacebar snapshots the current quaternion as `quaternionBase` and subsequent rotations are taken relative to it (calibration / "zero" pose).
- **Position**: from sensor 10. Buffer accelerations, average them, integrate twice (a → v → p) with a `SCALE` divisor of 5000 and a position-dependent friction (`frictionFunction`) that grows quadratically and only damps velocity moving *away* from origin (`ifSameSign`). Currently disabled in `animate()` — translation drifts too much without visual correction.
- **Rendering**: three.js scene with ambient + point light, axes helper, camera at `(0,0,30)`. The GLB's `children[1]` is the saber mesh (children[0] is presumably an empty / parent node).

## Running it (legacy setup)

No build step. `client/src/index.html` script-tags `three.js` and `GLTFLoader.js` straight out of `node_modules`, so you serve `client/` over any static server and open it in a browser. Server is `node server/src/index.js` after `npm i ws`.

## Phone app (`phone/`)

Expo SDK 52, JavaScript (no TypeScript). Entry is `App.js`. The UI is one screen: server URL input + Start/Stop + status/rate readout.

### Sensor source — local Expo native module

`expo-sensors`' `DeviceMotion` only exposes Euler angles, which throws away the OS-fused quaternion. We need the fused quaternion directly, so `phone/modules/sensor-fusion/` is a **local Expo Module** that bridges to platform sensor APIs:

- **Android** (`SensorFusionModule.kt`): subscribes to `Sensor.TYPE_GAME_ROTATION_VECTOR` (preferred — gyro + accel only, no magnetometer drift) with fallback to `Sensor.TYPE_ROTATION_VECTOR`. Converts via `SensorManager.getQuaternionFromVector`. Linear accel from `Sensor.TYPE_LINEAR_ACCELERATION` (m/s², gravity removed).
- **iOS** (`SensorFusionModule.swift`): `CMMotionManager.startDeviceMotionUpdates(using: .xArbitraryCorrectedZVertical)` → `CMAttitude.quaternion` and `CMDeviceMotion.userAcceleration`. userAcceleration is in g's, multiplied by 9.81 to match Android's m/s² convention.

The module emits two events: `onRotation` `{t,x,y,z,w}` and `onAcceleration` `{t,x,y,z}`. `t` is a nanosecond timestamp from the platform sensor stack.

### Wire format

Same CSV protocol as before, so `server/` and `client/` are unchanged:

- `15,t,x,y,z,w` — quaternion
- `10,t,x,y,z` — linear acceleration

### Dev build required, not Expo Go

Because of the local native module, Expo Go cannot run this app. Use a development build:

```bash
cd phone
npm install
npx expo prebuild           # generates ios/ and android/ directories
npx expo run:ios            # or run:android
```

For iterating on JS only, after the first run: `npm start` (launches dev server, point dev client at it).

### Axis-frame caveat

Android `TYPE_GAME_ROTATION_VECTOR` and iOS `.xArbitraryCorrectedZVertical` use different reference frames. The browser client's spacebar-calibration (`quaternionBase`) absorbs the resting-pose offset at startup, but mid-motion axes won't perfectly correspond between iOS and Android. If this becomes a problem, normalize in the native module before emitting.

## Repo conventions

- No build tooling, no linter, no tests. JavaScript is ES5/ES6 in plain `<script>` tags on the client side.
- Nothing here is precious — the user has stated explicitly that breaking changes are fine and the whole thing is expected to be rewritten. Optimize for clarity over backward-compat.
