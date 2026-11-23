import express from 'express';
import { startWebSocketServer } from './webSocket.js'
import fs from 'fs'
import https from 'https'

const app = express()
const port = 3000


app.use('/', express.static('./client/src/'));
app.use('/node_modules', express.static('./node_modules'));
app.use('/res', express.static('./client/res'));

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})

const options = {
  key: fs.readFileSync('./server.key'),
  cert: fs.readFileSync('./server.cert'),
};

const phoneApp = express()
const phonePort = 3001
phoneApp.use('/', express.static('./phone/'));
const server = https.createServer(options, phoneApp);
startWebSocketServer()
server.listen(phonePort)