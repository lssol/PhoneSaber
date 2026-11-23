import { WebSocketServer } from 'ws'
import { Counter } from './counter.js'
import https from 'https'
import fs from 'fs'

export const startWebSocketServer = () => {
    const server = https.createServer({
        key: fs.readFileSync('./server.key'),
        cert: fs.readFileSync('./server.cert'),
    })
    const wss = new WebSocketServer({ server })

    const counter = Counter()
    let connections = []

    wss.on('connection', function connection(ws) {
        connections.push(ws)
        ws.on('message', function incoming(message) {
            counter.incrementCount()
            connections.filter(con => con != ws).forEach(con => con.send(message))
        })
    })
    server.listen(8080)
}