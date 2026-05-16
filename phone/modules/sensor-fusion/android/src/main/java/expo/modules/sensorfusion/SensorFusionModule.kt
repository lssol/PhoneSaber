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

  override fun definition() = ModuleDefinition {
    Name("SensorFusionModule")

    Events("onRotation", "onAcceleration")

    Function("start") { intervalMicros: Int ->
      val ctx = appContext.reactContext ?: return@Function
      val sm = ctx.getSystemService(Context.SENSOR_SERVICE) as SensorManager
      sensorManager = sm

      // Prefer GAME_ROTATION_VECTOR (no magnetometer => no yaw drift from magnetic field);
      // fall back to TYPE_ROTATION_VECTOR if not available.
      val rotSensor = sm.getDefaultSensor(Sensor.TYPE_GAME_ROTATION_VECTOR)
        ?: sm.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)
      val accelSensor = sm.getDefaultSensor(Sensor.TYPE_LINEAR_ACCELERATION)

      rotSensor?.let { sensor ->
        val listener = object : SensorEventListener {
          private val q = FloatArray(4)
          override fun onSensorChanged(event: SensorEvent) {
            // event.values for rotation vector is [x, y, z, w, accuracy?]
            // getQuaternionFromVector writes [w, x, y, z] into q.
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
        sm.registerListener(listener, sensor, intervalMicros)
        rotationListener = listener
      }

      accelSensor?.let { sensor ->
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
        sm.registerListener(listener, sensor, intervalMicros)
        accelListener = listener
      }
    }

    Function("stop") {
      val sm = sensorManager
      rotationListener?.let { sm?.unregisterListener(it) }
      accelListener?.let { sm?.unregisterListener(it) }
      rotationListener = null
      accelListener = null
    }
  }
}
