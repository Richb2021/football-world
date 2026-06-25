import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((buf) => {
      this.result = buf;
      this.onloadend?.();
    }, (err) => this.onerror?.(err));
  }

  readAsDataURL(blob) {
    blob.arrayBuffer().then((buf) => {
      this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(buf).toString('base64')}`;
      this.onloadend?.();
    }, (err) => this.onerror?.(err));
  }
};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public/assets/models/player_segmented_source.glb');

const scene = new THREE.Scene();
scene.name = 'SegmentedSoccerPlayer';

const materials = {
  shirt: material('kit_shirt', '#f6f6f2'),
  shorts: material('kit_shorts', '#8f9499'),
  socks: material('kit_socks', '#f7f7f4'),
  skin: material('skin', '#b9794f'),
  hair: material('hair', '#171412'),
  boots: material('boots', '#111111'),
};

addTorso();
addHead();
addArms();
addLegs();

const exporter = new GLTFExporter();
const result = await new Promise((resolve, reject) => {
  exporter.parse(scene, resolve, reject, { binary: true, onlyVisible: true });
});
writeFileSync(OUT, Buffer.from(result));
console.log(`${OUT} ${(Buffer.byteLength(Buffer.from(result)) / 1024).toFixed(0)}kB`);

function material(name, color) {
  const mat = new THREE.MeshStandardMaterial({
    name,
    color: new THREE.Color(color),
    roughness: 0.82,
    metalness: 0,
  });
  return mat;
}

function mesh(name, geometry, mat, position, rotation = [0, 0, 0], scale = [1, 1, 1]) {
  const m = new THREE.Mesh(geometry, mat);
  m.name = name;
  m.position.set(...position);
  m.rotation.set(...rotation);
  m.scale.set(...scale);
  m.castShadow = true;
  scene.add(m);
  return m;
}

function addTorso() {
  mesh('kit_shirt_torso', new THREE.CylinderGeometry(0.3, 0.38, 0.54, 14), materials.shirt, [0, 1.18, 0]);
  mesh('kit_shirt_chest', new THREE.BoxGeometry(0.58, 0.18, 0.26), materials.shirt, [0, 1.38, 0.02]);
  mesh('neck_skin', new THREE.CylinderGeometry(0.09, 0.1, 0.12, 12), materials.skin, [0, 1.51, 0]);
  mesh('kit_shorts_hips', new THREE.CylinderGeometry(0.36, 0.33, 0.24, 14), materials.shorts, [0, 0.84, 0]);
}

function addHead() {
  mesh('head_skin', new THREE.SphereGeometry(0.17, 16, 12), materials.skin, [0, 1.68, 0.02], [0, 0, 0], [0.92, 1.08, 0.9]);
  mesh('nose_skin', new THREE.SphereGeometry(0.035, 8, 6), materials.skin, [0, 1.67, 0.17], [0, 0, 0], [0.75, 0.75, 1.35]);
  mesh('hair_cap', new THREE.SphereGeometry(0.175, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), materials.hair, [0, 1.76, 0.0], [0, 0, 0], [1.03, 0.65, 1.0]);
}

function addArms() {
  for (const side of [-1, 1]) {
    mesh(`kit_shirt_sleeve_${side}`, new THREE.CylinderGeometry(0.085, 0.095, 0.28, 10), materials.shirt, [side * 0.42, 1.34, 0], [0, 0, Math.PI / 2]);
    mesh(`forearm_skin_${side}`, new THREE.CylinderGeometry(0.065, 0.075, 0.42, 10), materials.skin, [side * 0.76, 1.34, 0], [0, 0, Math.PI / 2]);
    mesh(`hand_skin_${side}`, new THREE.SphereGeometry(0.075, 10, 8), materials.skin, [side * 1.0, 1.34, 0.02], [0, 0, 0], [1.08, 0.82, 0.72]);
  }
}

function addLegs() {
  for (const side of [-1, 1]) {
    mesh(`kit_shorts_leg_${side}`, new THREE.CylinderGeometry(0.115, 0.13, 0.34, 10), materials.shorts, [side * 0.14, 0.62, 0], [0, 0, 0]);
    mesh(`knee_skin_${side}`, new THREE.SphereGeometry(0.085, 10, 8), materials.skin, [side * 0.14, 0.42, 0.01], [0, 0, 0], [0.9, 0.72, 0.82]);
    mesh(`kit_socks_${side}`, new THREE.CylinderGeometry(0.08, 0.07, 0.42, 10), materials.socks, [side * 0.14, 0.22, 0], [0, 0, 0]);
    mesh(`boot_${side}`, new THREE.BoxGeometry(0.16, 0.08, 0.28), materials.boots, [side * 0.14, 0.02, 0.06], [0, 0, 0]);
  }
}
