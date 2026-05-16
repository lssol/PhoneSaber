import ExpoModulesCore
import CoreMotion
import AVFoundation
import MediaPlayer
import UIKit

public class SensorFusionModule: Module {
  private let motionManager = CMMotionManager()
  private var volumeObserver: NSKeyValueObservation?
  private var hiddenVolumeView: MPVolumeView?
  private var baselineVolume: Float = 0.5
  private var resettingVolume = false

  public func definition() -> ModuleDefinition {
    Name("SensorFusionModule")

    Events("onRotation", "onAcceleration", "onCalibrate")

    OnCreate {
      self.startVolumeButtonObserver()
    }

    OnDestroy {
      self.stopVolumeButtonObserver()
    }

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

  // MARK: - Volume-button calibration trigger
  //
  // iOS doesn't expose hardware volume key events directly. The standard hack
  // is KVO on AVAudioSession.outputVolume: any volume button press fires it.
  // We then snap the volume back to a baseline so the user can press again,
  // and hide the system volume HUD by mounting a zero-size MPVolumeView.
  private func startVolumeButtonObserver() {
    DispatchQueue.main.async {
      // Off-screen MPVolumeView suppresses the system volume HUD on iOS 13+.
      let view = MPVolumeView(frame: CGRect(x: -1000, y: -1000, width: 1, height: 1))
      view.isHidden = false
      if let window = UIApplication.shared.windows.first {
        window.addSubview(view)
      }
      self.hiddenVolumeView = view

      do {
        try AVAudioSession.sharedInstance().setActive(true)
      } catch {
        return
      }
      let session = AVAudioSession.sharedInstance()
      self.baselineVolume = session.outputVolume == 0 || session.outputVolume == 1
        ? 0.5 : session.outputVolume

      self.volumeObserver = session.observe(\.outputVolume, options: [.new, .old]) { [weak self] session, change in
        guard let self = self else { return }
        guard let newValue = change.newValue, let oldValue = change.oldValue else { return }
        if self.resettingVolume {
          self.resettingVolume = false
          return
        }
        // Volume-down = newValue < oldValue. (Volume-up is ignored.)
        if newValue < oldValue {
          self.sendEvent("onCalibrate", ["t": Int64(Date().timeIntervalSince1970 * 1_000_000_000)])
        }
        // Reset to baseline so subsequent presses still register, even at 0/1.
        self.resettingVolume = true
        self.setSystemVolume(self.baselineVolume)
      }
    }
  }

  private func stopVolumeButtonObserver() {
    self.volumeObserver?.invalidate()
    self.volumeObserver = nil
    DispatchQueue.main.async {
      self.hiddenVolumeView?.removeFromSuperview()
      self.hiddenVolumeView = nil
    }
  }

  private func setSystemVolume(_ value: Float) {
    guard let slider = self.hiddenVolumeView?.subviews.compactMap({ $0 as? UISlider }).first else { return }
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.01) {
      slider.value = value
    }
  }
}
