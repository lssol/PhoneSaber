const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: 8080, host: "0.0.0.0" });


const Counter = () => {
  let currentCount = 0
  let startTime = 0
  let endTime = 0

  setInterval(() => {
    endTime = new Date().getTime()
    const ellapsed = endTime - startTime
    const nbPerSec = 1000*currentCount / ellapsed
    console.log("Speed: " + nbPerSec + " message/sec")
    currentCount = 0
    startTime = new Date().getTime()
  }, 500)

  return {
    count: () => {
      currentCount++
    }
  }
}

const counter = Counter()
let connections = []

wss.on('connection', function connection(ws) {
  connections.push(ws)
  ws.on('message', function incoming(message) {
    counter.count()
    connections.filter(con => con != ws).forEach(con => con.send(message))
  })
});

