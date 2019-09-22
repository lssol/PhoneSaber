
//// ROTATIONS
const quaternionBase = {x:0, y:0, z:0, w:0} 
const quaternion = {x:0, y:0, z:0, w:0}
const toQuaternion = (quaternionObject) => {
  var q = new THREE.Quaternion();
  q.x = quaternionObject.x
  q.y = quaternionObject.y
  q.z = quaternionObject.z
  q.w = quaternionObject.w

  return q
}
const getQuaternion = () => {
  const q = toQuaternion(quaternion)
  const qBase = toQuaternion(quaternionBase)
  return qBase.conjugate().multiply(q)
}
const updateRotation = (values) => {
  quaternion.x = values[2]
  quaternion.y = values[3]
  quaternion.z = values[4]
  quaternion.w = values[5]
}

///// POSITION
const position = {t: 0, x: 0, y: 0, z: 0}
const velocity = {t: 0, x: 0, y: 0, z: 0}
let acceleration = {t: 0, x: 0, y: 0, z: 0}
let accelerations = []
const SCALE = 5000
const updatePosition = (values) => {
  accelerations.push({
    t: values[1],
    x: values[2],
    y: values[3],
    z: values[4],
  })
}
const LimitFriction = {
  x: 8,
  y: 5,
  z: 2
}

const frictionFunction = () => {
  const x = Math.min(position.x * position.x / (LimitFriction.x * LimitFriction.x), 1)
  const y = Math.min(position.y * position.y / (LimitFriction.y * LimitFriction.y), 1)
  const z = Math.min(position.z * position.z / (LimitFriction.z * LimitFriction.z), 1)

  return {x, y, z}
}
const ifSameSign = (a, b) => {
  if (a * b > 0)
    return 1
  return 0
}
const applyFriction = () => {
  const friction = frictionFunction()
  console.log(friction)
  velocity.x = velocity.x * (1 - friction.x*ifSameSign(velocity.x, position.x))
  velocity.y = velocity.y * (1 - friction.y*ifSameSign(velocity.y, position.y))
  velocity.z = velocity.z * (1 - friction.z*ifSameSign(velocity.z, position.z))
}
const computeAverageAcceleration = () => {
  acceleration.x = 0
  acceleration.y = 0
  acceleration.z = 0
  for (acc of accelerations) {
    acceleration.x += acc.x
    acceleration.y += acc.y
    acceleration.z += acc.z
  }
  const len = accelerations.length
  console.log(len)
  acceleration.x = acceleration.x / len 
  acceleration.y = acceleration.y / len 
  acceleration.z = acceleration.z / len 
  acceleration.t = (accelerations[len-1].t - accelerations[0].t) / 2

  accelerations = []
}
const computePosition = () => {
  computeAverageAcceleration()
  if (velocity.t == 0)
    velocity.t = acceleration.t
  const deltaT = acceleration.t - velocity.t
  velocity.x += acceleration.x * deltaT
  velocity.y += acceleration.y * deltaT
  velocity.z += acceleration.z * deltaT
  velocity.t = acceleration.t

  applyFriction()
  if (position.t == 0)
    position.t = velocity.t
  position.x += velocity.x * deltaT / SCALE
  position.y += velocity.y * deltaT / SCALE
  position.z += velocity.z * deltaT / SCALE
  position.t = velocity.t

  return position
}
const getPosition = () => {
  computePosition()
  console.log(position.x)
  const vec = new THREE.Vector3( position.x, position.y, position.z )
  console.log(vec)
  return vec
}


///// Interaction with page
document.addEventListener("keydown", function(event) {
  if(event.keyCode == 32) {
    quaternionBase.x = quaternion.x
    quaternionBase.y = quaternion.y
    quaternionBase.z = quaternion.z
    quaternionBase.w = quaternion.w
  }
})


////// WebSocket
const socket = new WebSocket('ws://localhost:8080');
socket.addEventListener('open', function (event) {
  console.log('Connection established')
});
socket.addEventListener('message', function (event) {
  const values = event.data.split(',').map(v => parseFloat(v))
  if (values[0] == 15)
    updateRotation(values)
  else if (values[0] == 10)
    updatePosition(values)
});


////// THREE.JS

var scene = new THREE.Scene();
var camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 1000 );

var canvas = document.getElementsByTagName( 'canvas' )[0];
var context = canvas.getContext( 'webgl2', { alpha: false } );
var renderer = new THREE.WebGLRenderer( { canvas: canvas, context: context } )
renderer.setSize( window.innerWidth, window.innerHeight );
renderer.gammaOutput = true;
renderer.gammaFactor = 2.2;
document.body.appendChild( renderer.domElement );

var geometry = new THREE.BoxGeometry( 1, 2.2, 0.2 );
var material = new THREE.MeshStandardMaterial( { color: 0x00ff00 } );
var cube = new THREE.Mesh( geometry, material );
//scene.add( cube );

var loader = new THREE.GLTFLoader();
var saber = null
var box = null
loader.load( '../res/l2/lightsaber.glb', function ( gltf ) {
  const saberScene = gltf.scene
  saber = saberScene.children[1]
  scene.add( saber );
  saber.scale.multiplyScalar(0.1)
  saber.position.multiplyScalar(0)
  box = new THREE.Box3().setFromObject( saber )
}, undefined, function ( error ) {
	console.error( error );
} );
scene.add( new THREE.AxesHelper() );

var ambiantLight = new THREE.AmbientLight( 0xffffff, 20);
var lightUp = new THREE.PointLight(0xffffff, 50, 20)
lightUp.position.set(5, 5, 10)
scene.add( ambiantLight );
scene.add(lightUp)

camera.position.set(0, 0, 30);


function animate() {
  requestAnimationFrame( animate );
  if (saber != null)
    saber.setRotationFromQuaternion(getQuaternion())

  // computePosition()
  // cube.position.x = position.x
  // cube.position.y = position.y
  // cube.position.z = position.z

	renderer.render( scene, camera );
}
animate();