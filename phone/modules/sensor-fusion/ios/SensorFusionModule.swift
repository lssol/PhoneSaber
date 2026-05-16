import ExpoModulesCore
import CoreMotion

public class SensorFusionModule: Module {
  private let motionManager = CMMotionManager()

  public func definition() -> ModuleDefinition {
    Name("SensorFusionModule")

    Events("onRotation", "onAcceleration")

    // intervalMicros: requested sampling interval in microseconds.
    Function("start") { (intervalMicros: Int) in
      let interval = max(Double(intervalMicros) / 1_000_000.0, 0.005)
      self.motionManager.deviceMotionUpdateInterval = interval

      guard self.motionManager.isDeviceMotionAvailable else { return }

      // .xArbitraryCorrectedZVertical uses gyro + accel + magnetometer with
      // magnetic-yaw correction (closest analog to Android TYPE_ROTATION_VECTOR).
      // For drift-free behavior without magnetometer (Android GAME_ROTATION_VECTOR
      // analog), use .xArbitraryZVertical instead.
      self.motionManager.startDeviceMotionUpdates(
        using: .xArbitraryCorrectedZVertical,
        to: OperationQueue.main
      ) { [weak self] (motion, _) in
        guard let self = self, let m = motion else { return }
        let t = Int64(m.timestamp * 1_000_000_000)
        let q = m.attitude.quaternion
        self.sendEvent("onRotation", [
          "t": t,
          "x": q.x,
          "y": q.y,
          "z": q.z,
          "w": q.w
        ])
        let a = m.userAcceleration
        // CoreMotion userAcceleration is in g's; multiply by 9.81 to match
        // Android's m/s² convention used by TYPE_LINEAR_ACCELERATION.
        self.sendEvent("onAcceleration", [
          "t": t,
          "x": a.x * 9.81,
          "y": a.y * 9.81,
          "z": a.z * 9.81
        ])
      }
    }

    Function("stop") {
      self.motionManager.stopDeviceMotionUpdates()
    }
  }
}
