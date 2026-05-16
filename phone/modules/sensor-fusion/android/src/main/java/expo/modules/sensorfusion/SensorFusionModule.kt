package expo.modules.sensorfusion

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class SensorFusionModule : Module() {
  private var sensorManager: SensorManager? = null
  private var rotationListener: SensorEventListener? = null
  private var accelListener: SensorEventListener? = null

  companion object {
    // MainActivity.onKeyDown hooks the hardware volume-down button and calls this.
    // Held as a process-wide singleton so MainActivity doesn't need a reference
    // to the live module instance (which is bound to the JS runtime lifecycle).
    @Volatile var calibrationTrigger: (() -> Unit)? = null
  }

  private fun startSensors(intervalMicros: Int) {
    val ctx = appContext.reactContext ?: return
    val sm = ctx.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    sensorManager = sm

    // Prefer GAME_ROTATION_VECTOR (gyro + accel, no magnetometer => no yaw drift);
    // fall back to TYPE_ROTATION_VECTOR if not available.
    val rotSensor = sm.getDefaultSensor(Sensor.TYPE_GAME_ROTATION_VECTOR)
      ?: sm.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)
    val accelSensor = sm.getDefaultSensor(Sensor.TYPE_LINEAR_ACCELERATION)

    if (rotSensor != null) {
      val listener = object : SensorEventListener {
        private val q = FloatArray(4)
        override fun onSensorChanged(event: SensorEvent) {
          // SensorManager.getQuaternionFromVector writes [w, x, y, z] into q.
          SensorManager.getQuaternionFromVector(q, event.values)
          sendEvent("onRotation", mapOf(
            "t" to event.timestamp,
            "x" to q[1].toDouble(),
            "y" to q[2].toDouble(),
            "z" to q[3].toDouble(),
            "w" to q[0].toDouble()
          ))
        }
        override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
      }
      sm.registerListener(listener, rotSensor, intervalMicros)
      rotationListener = listener
    }

    if (accelSensor != null) {
      val listener = object : SensorEventListener {
        override fun onSensorChanged(event: SensorEvent) {
          sendEvent("onAcceleration", mapOf(
            "t" to event.timestamp,
            "x" to event.values[0].toDouble(),
            "y" to event.values[1].toDouble(),
            "z" to event.values[2].toDouble()
          ))
        }
        override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
      }
      sm.registerListener(listener, accelSensor, intervalMicros)
      accelListener = listener
    }
  }

  private fun stopSensors() {
    val sm = sensorManager ?: return
    rotationListener?.let { sm.unregisterListener(it) }
    accelListener?.let { sm.unregisterListener(it) }
    rotationListener = null
    accelListener = null
  }

  override fun definition() = ModuleDefinition {
    Name("SensorFusionModule")

    Events("onRotation", "onAcceleration", "onCalibrate")

    OnCreate {
      calibrationTrigger = {
        sendEvent("onCalibrate", mapOf("t" to System.nanoTime()))
      }
    }

    OnDestroy {
      calibrationTrigger = null
    }

    Function("start") { intervalMicros: Int ->
      startSensors(intervalMicros)
    }

    Function("stop") {
      stopSensors()
    }
  }
}
