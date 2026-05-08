// Three.js scene bootstrap: renderer, scene, perspective camera, lights,
// starfield, and the DOM label layer. Other modules import these singletons.

import * as THREE from 'three';

export const canvas = document.getElementById('c');

export const renderer = new THREE.WebGLRenderer({
  canvas, antialias: true, logarithmicDepthBuffer: true,
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);

export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05060a);

// starfield — distant points so the background isn't pure black
{
  const stars = 4000;
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(stars * 3);
  for (let i = 0; i < stars; i++) {
    const r = 8000 + Math.random() * 4000;
    const t = Math.random() * Math.PI * 2;
    const p = Math.acos(2 * Math.random() - 1);
    pos[i*3]   = r * Math.sin(p) * Math.cos(t);
    pos[i*3+1] = r * Math.cos(p);
    pos[i*3+2] = r * Math.sin(p) * Math.sin(t);
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const m = new THREE.PointsMaterial({
    color: 0xffffff, size: 1.4, sizeAttenuation: false,
    transparent: true, opacity: 0.7,
  });
  scene.add(new THREE.Points(g, m));
}

export const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.01, 100000);
camera.position.set(0, 200, 400);

export const sunLight = new THREE.PointLight(0xfff4d6, 3, 0, 0);
scene.add(sunLight);
scene.add(new THREE.AmbientLight(0x222233, 0.6));

// Floating overlay where DOM labels for each body are positioned each frame.
export const labelLayer = document.createElement('div');
Object.assign(labelLayer.style, {
  position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: 6,
});
document.body.appendChild(labelLayer);

window.addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});
