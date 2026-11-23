webSocket = new WebSocket('wss://192.168.1.254:3001')
// webSocket = new WebSocket('wss://localhost:8080')
console.log('heyyy')
webSocket.send('helloooo')

const options = { frequency: 60, referenceFrame: "device" };
const sensor = new AbsoluteOrientationSensor(options);
Promise.all([
    navigator.permissions.query({ name: "accelerometer" }),
    navigator.permissions.query({ name: "magnetometer" }),
    navigator.permissions.query({ name: "gyroscope" }),
  ]).then((results) => {
    if (results.every((result) => result.state === "granted")) {
      sensor.start();
      // …
    } else {
      console.log("No permissions to use AbsoluteOrientationSensor.");
    }
  });
sensor.addEventListener("reading", () => {
    console.log('asdfsadf')
    console.log('quaternion', sensor.quaternion)
    document.querySelector('#message').textContent = sensor.quaternion
    wenSocket.send(sensor.quaternion)
});
sensor.addEventListener("error", (event) => {
    if (event.error.name === "NotReadableError") {
      console.log("Sensor is not available.");
    }
    console.log(event)
  });