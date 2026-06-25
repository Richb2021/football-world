import * as THREE from 'three';

/**
 * UV -> bind-pose body-position lookup, baked once per player model.
 *
 * Meshy textures are patchwork UV atlases, so painting kit patterns in texture
 * space scatters them randomly across the body. This map lets the kit painter
 * ask, for any texel, "where on the body is this?" — giving spatially correct
 * stripes, hoops, halves, sashes and sleeves.
 *
 * Coordinates per texel (normalized 0..1 over the bind-pose bounding box):
 *   lat — across the T-pose arm span (0 = left fingertip, 1 = right fingertip)
 *   ht  — height (0 = feet, 1 = head)
 *   dep — front/back
 * A fourth channel marks texel coverage (0 = no UV island here).
 */
export interface BodyMap {
  size: number;
  data: Float32Array; // size*size*4: lat, ht, dep, coverage
}

export function sampleBodyMap(map: BodyMap, u: number, v: number): { lat: number; ht: number; dep: number } | null {
  const x = Math.min(map.size - 1, Math.max(0, Math.floor(u * map.size)));
  const y = Math.min(map.size - 1, Math.max(0, Math.floor(v * map.size)));
  const i = (y * map.size + x) * 4;
  if (map.data[i + 3] < 0.5) return null;
  return { lat: map.data[i], ht: map.data[i + 1], dep: map.data[i + 2] };
}

/** Rasterize the first skinned/uv mesh of the model into a body-position map. */
export function bakeBodyMap(root: THREE.Object3D, size = 512): BodyMap | null {
  let geometry: THREE.BufferGeometry | null = null;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!geometry && mesh.isMesh && mesh.geometry?.attributes?.uv && mesh.geometry?.attributes?.position) {
      geometry = mesh.geometry;
    }
  });
  if (!geometry) return null;
  const geo = geometry as THREE.BufferGeometry;
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const index = geo.index;

  // bind-pose bounds; in a T-pose the arm span is the widest horizontal axis
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const ext = new THREE.Vector3().subVectors(bb.max, bb.min);
  const latAxis: 'x' | 'z' = ext.x >= ext.z ? 'x' : 'z';
  const depAxis: 'x' | 'z' = latAxis === 'x' ? 'z' : 'x';

  const norm = (axis: 'x' | 'y' | 'z', value: number) => {
    const min = bb.min[axis];
    const span = Math.max(1e-6, bb.max[axis] - bb.min[axis]);
    return (value - min) / span;
  };

  const data = new Float32Array(size * size * 4);
  const triCount = index ? index.count / 3 : pos.count / 3;
  const vi = (t: number, k: number) => (index ? index.getX(t * 3 + k) : t * 3 + k);

  for (let t = 0; t < triCount; t++) {
    const a = vi(t, 0), b = vi(t, 1), c = vi(t, 2);
    // texture pixel space: u right, v measured from the top (glTF convention)
    const ax = uv.getX(a) * size, ay = uv.getY(a) * size;
    const bx = uv.getX(b) * size, by = uv.getY(b) * size;
    const cx = uv.getX(c) * size, cy = uv.getY(c) * size;
    const pa = { lat: norm(latAxis, pos[`get${latAxis.toUpperCase()}` as 'getX'](a)), ht: norm('y', pos.getY(a)), dep: norm(depAxis, pos[`get${depAxis.toUpperCase()}` as 'getX'](a)) };
    const pb = { lat: norm(latAxis, pos[`get${latAxis.toUpperCase()}` as 'getX'](b)), ht: norm('y', pos.getY(b)), dep: norm(depAxis, pos[`get${depAxis.toUpperCase()}` as 'getX'](b)) };
    const pc = { lat: norm(latAxis, pos[`get${latAxis.toUpperCase()}` as 'getX'](c)), ht: norm('y', pos.getY(c)), dep: norm(depAxis, pos[`get${depAxis.toUpperCase()}` as 'getX'](c)) };

    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)) - 1);
    const maxX = Math.min(size - 1, Math.ceil(Math.max(ax, bx, cx)) + 1);
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)) - 1);
    const maxY = Math.min(size - 1, Math.ceil(Math.max(ay, by, cy)) + 1);
    const denom = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(denom) < 1e-9) continue;

    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const fx = px + 0.5, fy = py + 0.5;
        let w0 = ((by - cy) * (fx - cx) + (cx - bx) * (fy - cy)) / denom;
        let w1 = ((cy - ay) * (fx - cx) + (ax - cx) * (fy - cy)) / denom;
        let w2 = 1 - w0 - w1;
        // small tolerance so island edges get covered
        const eps = -0.02;
        if (w0 < eps || w1 < eps || w2 < eps) continue;
        w0 = Math.max(0, w0); w1 = Math.max(0, w1); w2 = Math.max(0, w2);
        const sum = w0 + w1 + w2 || 1;
        const i = (py * size + px) * 4;
        data[i] = (w0 * pa.lat + w1 * pb.lat + w2 * pc.lat) / sum;
        data[i + 1] = (w0 * pa.ht + w1 * pb.ht + w2 * pc.ht) / sum;
        data[i + 2] = (w0 * pa.dep + w1 * pb.dep + w2 * pc.dep) / sum;
        data[i + 3] = 1;
      }
    }
  }

  dilate(data, size, 3);
  return { size, data };
}

/** Spread covered texels outward a few steps so bilinear sampling at island edges stays correct. */
function dilate(data: Float32Array, size: number, steps: number) {
  for (let s = 0; s < steps; s++) {
    const snapshot = Float32Array.from(data);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        if (snapshot[i + 3] >= 0.5) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= size || ny < 0 || ny >= size) continue;
          const j = (ny * size + nx) * 4;
          if (snapshot[j + 3] >= 0.5) {
            data[i] = snapshot[j];
            data[i + 1] = snapshot[j + 1];
            data[i + 2] = snapshot[j + 2];
            data[i + 3] = 1;
            break;
          }
        }
      }
    }
  }
}
