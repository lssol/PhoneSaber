const rotationBase = {
  x:0,
  y:0,
  z:0
} 
const rotation = {
  x:0,
  y:0,
  z:0
}

document.addEventListener("keydown", function(event) {
  if(event.keyCode == 32) {
    rotationBase.x = rotation.x
    rotationBase.y = rotation.y
    rotationBase.z = rotation.z
  }
})

const getRotation = () => ({
  x: rotation.x - rotationBase.x,
  y: rotation.y - rotationBase.y,
  z: rotation.z - rotationBase.z,
})

const socket = new WebSocket('ws://localhost:8080');
socket.addEventListener('open', function (event) {
  console.log('Connection established')
});

const toEuler = (w, x, y, z) => {
  const sinr_cosp = 2*(w*x + y*z)
  const cosr_cosp = 1 - 2 * (x*x + y*y)
  const roll = Math.atan2(sinr_cosp, cosr_cosp)

  const sinp = 2 * (w*y - z*x)
  let pitch = 0
  if (Math.abs(sinp) >= 1)
    pitch = Math.PI / 2 * Math.sign(sinp)
  else
    pitch = Math.asin(sinp)

  const siny_cosp = 2*(w*z + x*y)
  const cosy_cosp = 1 - 2*(y*y + z*z)
  const yaw = Math.atan2(siny_cosp, cosy_cosp)

  return {
    roll,
    pitch,
    yaw
  }
}


const updateRotation = (values) => {
  const euler = toEuler(values[5], values[2], values[3], values[4])
  rotation.x = euler.roll
  rotation.y = euler.pitch
  rotation.z = euler.yaw
}

const position = {
  x = 0,
  y = 0,
  z = 0
}
const velocity = {
  x = 0,
  y = 0,
  z = 0
}

const accelerations = []

const updatePosition = (values) => {
  accelerations.push({
    t: values[1],
    x: values[2],
    y: values[3],
    z: values[4],
  })
}

socket.addEventListener('message', function (event) {
  console.log(event.data)
  const values = event.data.split(',').map(v => parseFloat(v))
  if (values[0] == 15)
    updateRotation(values)
  else if (values[0] == 1)
    updatePosition(values)
});


var scene = new THREE.Scene();
var camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 1000 );

var canvas = document.getElementsByTagName( 'canvas' )[0];
var context = canvas.getContext( 'webgl2', { alpha: true } );
var renderer = new THREE.WebGLRenderer( { canvas: canvas, context: context } );renderer.setSize( window.innerWidth, window.innerHeight );
document.body.appendChild( renderer.domElement );

var geometry = new THREE.BoxGeometry( 1, 2.2, 0.2 );
var material = new THREE.MeshStandardMaterial( { color: 0x00ff00 } );
var cube = new THREE.Mesh( geometry, material );
scene.add( cube );

var ambiantLight = new THREE.AmbientLight( 0xffffff, 20);
var lightUp = new THREE.PointLight(0xffffff, 50, 20)
lightUp.position.set(5, 5, 10)
scene.add( ambiantLight );
scene.add(lightUp)

camera.position.set(0, 0, 5);


const computePosition = () => {
  let vel = velocity
  accelerations.forEach(() => {
    
  })
}

function animate() {
  requestAnimationFrame( animate );
  
  var rot = getRotation()
  cube.rotation.x = rot.x;
  cube.rotation.y = rot.y;
  cube.rotation.z = rot.z;

	renderer.render( scene, camera );
}
animate();