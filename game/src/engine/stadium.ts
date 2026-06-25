import * as THREE from 'three';
import {
  CENTER_CIRCLE_R, GOAL_HALF_WIDTH, GOAL_HEIGHT, GOAL_DEPTH, HALF_LEN, HALF_WID,
  PENALTY_BOX_DEPTH, PENALTY_BOX_HALF_WIDTH, PENALTY_SPOT, SIX_BOX_DEPTH, SIX_BOX_HALF_WIDTH,
} from '../sim/constants';
import type { GameAssets } from './assets';
import type { MatchCrowdDensity, MatchVenueProfile } from '../sim/types';

const APRON = 6; // grass beyond the lines

export type StadiumTimeOfDay = 'day' | 'evening' | 'night';
export type StadiumWeather = 'normal' | 'sunny' | 'rain' | 'snow' | 'ice';

export interface StadiumOptions {
  timeOfDay: StadiumTimeOfDay;
  weather: StadiumWeather;
  venueProfile?: MatchVenueProfile;
  crowdDensity?: MatchCrowdDensity;
  adBoardCreatives?: PitchBoardCreative[];
}

export interface PitchBoardCreative {
  text: string;
  background: string;
  foreground: string;
  imageUrl?: string;
}

export interface StadiumRenderProfile {
  standDepth: number;
  standHeight: number;
  crowdPlaneHeight: number;
  includeEndStands: boolean;
  useBowl: boolean;
  crowdFill: number;
  emptySeatAlpha: number;
}

export interface StadiumBowlRenderProfile {
  radius: number;
  height: number;
  y: number;
  thetaStart: number;
  thetaLength: number;
  radialSegments: number;
  scaleZ: number;
}

interface PitchPalette {
  base: string;
  stripeA: string;
  stripeB: string;
  line: string;
  surround: string;
  useGrassOverlay: boolean;
}

const PITCH_PALETTES: Record<StadiumWeather, PitchPalette> = {
  normal: { base: '#2e7d32', stripeA: '#2e8b34', stripeB: '#27732c', line: 'rgba(255,255,255,0.92)', surround: '#1c2b22', useGrassOverlay: true },
  sunny: { base: '#3c9a42', stripeA: '#43a649', stripeB: '#368d3c', line: 'rgba(255,255,255,0.94)', surround: '#273a2a', useGrassOverlay: true },
  rain: { base: '#23632a', stripeA: '#246b2c', stripeB: '#1d5824', line: 'rgba(235,240,245,0.85)', surround: '#15211b', useGrassOverlay: true },
  snow: { base: '#e8edf2', stripeA: '#e3e9ef', stripeB: '#d8e0e8', line: 'rgba(214,72,52,0.95)', surround: '#cfd8e0', useGrassOverlay: false },
  ice: { base: '#c5dcea', stripeA: '#cde2ee', stripeB: '#b8d3e4', line: 'rgba(28,70,140,0.9)', surround: '#9fb6c4', useGrassOverlay: false },
};

/** Paint the pitch (stripes + markings) into a canvas; optionally blend the generated grass texture. */
function paintPitchCanvas(grassImg: HTMLImageElement | null, weather: StadiumWeather): HTMLCanvasElement {
  const palette = PITCH_PALETTES[weather];
  const W = 2100, H = 1400; // 105m x 70m scaled: 20px per metre on x
  const ppmX = W / (105 + APRON * 2);
  const ppmY = H / (68 + APRON * 2);
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  // base green
  ctx.fillStyle = palette.base;
  ctx.fillRect(0, 0, W, H);

  // mow stripes along x
  const stripes = 14;
  const stripeW = W / stripes;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 === 0 ? palette.stripeA : palette.stripeB;
    ctx.fillRect(i * stripeW, 0, stripeW + 1, H);
  }

  // grass detail overlay
  if (grassImg && palette.useGrassOverlay) {
    ctx.globalAlpha = 0.35;
    ctx.globalCompositeOperation = 'overlay';
    const tile = 384;
    for (let x = 0; x < W; x += tile) {
      for (let y = 0; y < H; y += tile) ctx.drawImage(grassImg, x, y, tile, tile);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // markings
  const X = (m: number) => (m + 52.5 + APRON) * ppmX;
  const Y = (m: number) => (m + 34 + APRON) * ppmY;
  ctx.strokeStyle = palette.line;
  ctx.lineWidth = 3.2;
  ctx.lineJoin = 'round';

  // outline + halfway
  ctx.strokeRect(X(-52.5), Y(-34), 105 * ppmX, 68 * ppmY);
  ctx.beginPath();
  ctx.moveTo(X(0), Y(-34));
  ctx.lineTo(X(0), Y(34));
  ctx.stroke();
  // centre circle + spot
  ctx.beginPath();
  ctx.arc(X(0), Y(0), CENTER_CIRCLE_R * ppmX, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(X(0), Y(0), 4, 0, Math.PI * 2);
  ctx.fillStyle = palette.line;
  ctx.fill();

  for (const s of [-1, 1]) {
    const gx = s * 52.5;
    // penalty box
    ctx.strokeRect(
      Math.min(X(gx), X(gx - s * PENALTY_BOX_DEPTH)), Y(-PENALTY_BOX_HALF_WIDTH),
      PENALTY_BOX_DEPTH * ppmX, PENALTY_BOX_HALF_WIDTH * 2 * ppmY,
    );
    // six yard box
    ctx.strokeRect(
      Math.min(X(gx), X(gx - s * SIX_BOX_DEPTH)), Y(-SIX_BOX_HALF_WIDTH),
      SIX_BOX_DEPTH * ppmX, SIX_BOX_HALF_WIDTH * 2 * ppmY,
    );
    // spot
    ctx.beginPath();
    ctx.arc(X(gx - s * PENALTY_SPOT), Y(0), 4, 0, Math.PI * 2);
    ctx.fill();
    // D arc
    ctx.beginPath();
    const cx = X(gx - s * PENALTY_SPOT);
    const r = CENTER_CIRCLE_R * ppmX;
    const cut = Math.acos((PENALTY_BOX_DEPTH - PENALTY_SPOT) * ppmX / r);
    if (s > 0) ctx.arc(cx, Y(0), r, Math.PI - cut, Math.PI + cut);
    else ctx.arc(cx, Y(0), r, -cut, cut);
    ctx.stroke();
    // corner arcs
    for (const cy of [-34, 34]) {
      ctx.beginPath();
      ctx.arc(X(gx), Y(cy), 1 * ppmX, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  return canvas;
}

export interface StadiumHandles {
  group: THREE.Group;
  pitchSizeX: number;
  pitchSizeZ: number;
}

export function buildStadium(assets: GameAssets, homeName: string, opts: StadiumOptions = { timeOfDay: 'day', weather: 'normal' }): StadiumHandles {
  const palette = PITCH_PALETTES[opts.weather];
  const night = opts.timeOfDay === 'night';
  const evening = opts.timeOfDay === 'evening';
  const profile = resolveStadiumRenderProfile(opts);
  const group = new THREE.Group();

  // ---- pitch
  const grassImg = assets.textures.grass?.image as HTMLImageElement | null;
  const canvas = paintPitchCanvas(grassImg ?? null, opts.weather);
  const pitchTex = new THREE.CanvasTexture(canvas);
  pitchTex.colorSpace = THREE.SRGBColorSpace;
  pitchTex.anisotropy = 8;
  const sizeX = 105 + APRON * 2;
  const sizeZ = 68 + APRON * 2;
  const pitch = new THREE.Mesh(
    new THREE.PlaneGeometry(sizeX, sizeZ),
    new THREE.MeshLambertMaterial({ map: pitchTex }),
  );
  pitch.rotation.x = -Math.PI / 2;
  pitch.receiveShadow = true;
  group.add(pitch);

  // surrounding ground
  const apronOuter = new THREE.Mesh(
    new THREE.PlaneGeometry(sizeX + 70, sizeZ + 70),
    new THREE.MeshLambertMaterial({ color: new THREE.Color(palette.surround) }),
  );
  apronOuter.rotation.x = -Math.PI / 2;
  apronOuter.position.y = -0.02;
  group.add(apronOuter);

  // ---- goals
  for (const s of [-1, 1]) {
    group.add(buildGoal(s));
  }

  // ---- ad boards
  const boards = buildAdBoards(homeName, opts.adBoardCreatives);
  group.add(boards);

  // ---- stands with crowd
  const crowdTex = makeCrowdTexture(profile);
  crowdTex.wrapS = crowdTex.wrapT = THREE.RepeatWrapping;
  // unlit material: the lower tiers sat in shadow and read far too dark
  const crowdTint = night ? 0xb8c2d6 : evening ? 0xf2dcc4 : 0xffffff;
  const standMat = new THREE.MeshBasicMaterial({ map: crowdTex, color: crowdTint });
  const standDark = new THREE.MeshLambertMaterial({ color: 0x18202a });
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x2b3645 });

  const mkStand = (length: number, horizontal: boolean, centerGap = 0) => {
    const stand = new THREE.Group();
    const depth = profile.standDepth;
    const height = profile.standHeight;
    // tiered slope of crowd: a tilted plane
    const crowd = new THREE.Mesh(new THREE.PlaneGeometry(length, profile.crowdPlaneHeight), standMat.clone());
    (crowd.material as THREE.MeshBasicMaterial).map = crowdTex.clone();
    (crowd.material as THREE.MeshBasicMaterial).map!.repeat.set(length / 26, Math.max(1, profile.crowdPlaneHeight / 8));
    (crowd.material as THREE.MeshBasicMaterial).map!.needsUpdate = true;
    crowd.position.set(0, height / 2 + 1.2, -depth / 2);
    crowd.rotation.x = Math.PI / 7.2;
    stand.add(crowd);
    // base wall — split around a central gap (for the players' tunnel) when asked
    if (centerGap > 0) {
      const seg = (length - centerGap) / 2;
      for (const sx of [-(centerGap / 2 + seg / 2), centerGap / 2 + seg / 2]) {
        const w = new THREE.Mesh(new THREE.BoxGeometry(seg, 2.4, 0.8), standDark);
        w.position.set(sx, 1.2, 0.4);
        stand.add(w);
      }
    } else {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(length, 2.4, 0.8), standDark);
      wall.position.set(0, 1.2, 0.4);
      stand.add(wall);
    }
    // roof
    const roof = new THREE.Mesh(new THREE.BoxGeometry(length, 0.5, depth * 0.82), roofMat);
    roof.position.set(0, height + 2.4, -depth / 2 - 1.5);
    stand.add(roof);
    return stand;
  };

  const sideOffset = sizeZ / 2 + 2.5;
  const north = mkStand(sizeX + 26, true, 6.5); // gap in the base wall for the tunnel
  north.position.set(0, 0, -sideOffset);
  group.add(north);
  const south = mkStand(sizeX + 26, true);
  south.rotation.y = Math.PI;
  south.position.set(0, 0, sideOffset);
  group.add(south);
  if (profile.includeEndStands) {
    const endOffset = sizeX / 2 + 2.5;
    const east = mkStand(sizeZ + 18, false);
    east.rotation.y = -Math.PI / 2;
    east.position.set(endOffset, 0, 0);
    group.add(east);
    const west = mkStand(sizeZ + 18, false);
    west.rotation.y = Math.PI / 2;
    west.position.set(-endOffset, 0, 0);
    group.add(west);
  }

  // ---- floodlights (lit after dark, with visible beams)
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      group.add(buildFloodlight(sx * (sizeX / 2 + 12), sz * (sizeZ / 2 + 12), night || evening));
    }
  }

  // ---- sky + surrounds
  group.add(buildSkyDome(opts));
  group.add(buildWalkways(sizeX, sizeZ, opts.weather));

  // ---- pre-rendered upper bowl: a panoramic ring rising behind the stands
  const bowlTex = (night || evening)
    ? (assets.textures.stadiumBowlNight ?? assets.textures.stadiumBowl)
    : (assets.textures.stadiumBowl ?? assets.textures.stadiumBowlNight);
  if (bowlTex && profile.useBowl) {
    const bowlProfile = resolveBowlRenderProfile(sizeX, sizeZ);
    const ring = new THREE.Mesh(
      new THREE.CylinderGeometry(
        bowlProfile.radius,
        bowlProfile.radius * 0.94,
        bowlProfile.height,
        bowlProfile.radialSegments,
        1,
        true,
        bowlProfile.thetaStart,
        bowlProfile.thetaLength,
      ),
      new THREE.MeshBasicMaterial({ map: bowlTex.clone(), side: THREE.BackSide, fog: false }),
    );
    const mat = ring.material as THREE.MeshBasicMaterial;
    mat.map!.repeat.set(4, 1); // panorama tiles around the bowl
    mat.map!.needsUpdate = true;
    ring.position.y = bowlProfile.y; // starts behind the modelled lower tier
    ring.scale.z = bowlProfile.scaleZ; // squash to the pitch's aspect
    group.add(ring);
  }

  // ---- players' tunnel + dugouts at the halfway-line touchline (north side),
  // where the teams walk out before kickoff. The tunnel is built procedurally so
  // it has a guaranteed dark recessed mouth facing the pitch, aligned with the
  // walk-out path (players queue deep in the dark and emerge through the opening).
  {
    const tunnel = buildTunnel();
    // sit the branded surround flush in the gap of the north stand's front wall
    // (front face ≈ z=-41.7) so the mouth is cut INTO the stand and the dark
    // channel recesses back through it — nothing protrudes onto the apron.
    const standFrontZ = -(sizeZ / 2 + 2.5) + 0.8; // stand group z + wall front face
    tunnel.position.set(0, 0, standFrontZ - 0.15); // surround face just inside the wall plane
    group.add(tunnel);
  }
  if (assets.dugout) {
    for (const side of [-1, 1]) {
      const dugout = prepareDugout(assets.dugout, 6.5);
      dugout.position.set(side * 12.5, 0, -(sizeZ / 2 - 2.2));
      dugout.rotation.y = 0; // open front faces the pitch from the north touchline
      group.add(dugout);
    }
  }

  return { group, pitchSizeX: sizeX, pitchSizeZ: sizeZ };
}

export function resolveStadiumRenderProfile(opts: StadiumOptions): StadiumRenderProfile {
  const venue = opts.venueProfile ?? 'main-stadium';
  const density = opts.crowdDensity ?? 'full';
  const base: Record<MatchVenueProfile, Omit<StadiumRenderProfile, 'crowdFill' | 'emptySeatAlpha'>> = {
    training: {
      standDepth: 7,
      standHeight: 5.5,
      crowdPlaneHeight: 8,
      includeEndStands: false,
      useBowl: false,
    },
    'small-stadium': {
      standDepth: 11,
      standHeight: 8,
      crowdPlaneHeight: 13,
      includeEndStands: true,
      useBowl: false,
    },
    'main-stadium': {
      standDepth: 16,
      standHeight: 11,
      crowdPlaneHeight: 19,
      includeEndStands: true,
      useBowl: true,
    },
  };
  return { ...base[venue], ...resolveCrowdDensityProfile(density) };
}

export function resolveCrowdDensityProfile(density: MatchCrowdDensity): Pick<StadiumRenderProfile, 'crowdFill' | 'emptySeatAlpha'> {
  const densityProfile: Record<MatchCrowdDensity, Pick<StadiumRenderProfile, 'crowdFill' | 'emptySeatAlpha'>> = {
    empty: { crowdFill: 0, emptySeatAlpha: 0.92 },
    '20': { crowdFill: 0.2, emptySeatAlpha: 0.82 },
    '40': { crowdFill: 0.4, emptySeatAlpha: 0.68 },
    '60': { crowdFill: 0.6, emptySeatAlpha: 0.5 },
    '80': { crowdFill: 0.8, emptySeatAlpha: 0.28 },
    sparse: { crowdFill: 0.2, emptySeatAlpha: 0.82 },
    medium: { crowdFill: 0.6, emptySeatAlpha: 0.5 },
    full: { crowdFill: 1, emptySeatAlpha: 0.08 },
  };
  return densityProfile[density];
}

export function resolveBowlRenderProfile(sizeX: number, sizeZ: number): StadiumBowlRenderProfile {
  const seamOverlap = 0.18;
  const height = 42;
  return {
    radius: Math.max(sizeX, sizeZ) * 0.94,
    height,
    y: height / 2 + 5.5,
    thetaStart: -Math.PI / 2 - seamOverlap / 2,
    thetaLength: Math.PI * 2 + seamOverlap,
    radialSegments: 72,
    scaleZ: sizeZ / sizeX,
  };
}

/** A repeating International Cup "sponsor wall" panel for the tunnel interior. */
function brandedPanelTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#0b1638'; ctx.fillRect(0, 0, 256, 256);
  const cell = (ox: number, oy: number, s: number) => {
    ctx.fillStyle = '#13245c'; ctx.fillRect(ox + 5, oy + 5, s - 10, s - 10);
    // ball/cup emblem ring
    ctx.strokeStyle = '#ffd400'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(ox + s / 2, oy + s * 0.34, s * 0.15, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#5ad1ff';
    ctx.beginPath(); ctx.arc(ox + s / 2, oy + s * 0.34, s * 0.06, 0, Math.PI * 2); ctx.fill();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff'; ctx.font = `bold ${Math.round(s * 0.105)}px sans-serif`;
    ctx.fillText('INTERNATIONAL', ox + s / 2, oy + s * 0.62);
    ctx.fillStyle = '#ffd400'; ctx.font = `bold ${Math.round(s * 0.15)}px sans-serif`;
    ctx.fillText('CUP', ox + s / 2, oy + s * 0.78);
  };
  cell(0, 0, 128); cell(128, 0, 128); cell(0, 128, 128); cell(128, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** The branded header band that sits above the tunnel mouth. */
function tunnelHeaderTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 96;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#0b1638'; ctx.fillRect(0, 0, 512, 96);
  ctx.strokeStyle = '#ffd400'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(58, 48, 26, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#5ad1ff'; ctx.beginPath(); ctx.arc(58, 48, 11, 0, Math.PI * 2); ctx.fill();
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff'; ctx.font = 'bold 32px sans-serif';
  ctx.fillText('INTERNATIONAL', 100, 36);
  ctx.fillStyle = '#ffd400'; ctx.font = 'bold 40px sans-serif';
  ctx.fillText('CUP 2026', 100, 74);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * A players' tunnel CUT INTO the north stand (like the Wembley reference): a
 * branded International Cup surround sits flush in the gap of the stand's front
 * wall, framing a dark mouth that recesses straight back into the stand. Nothing
 * protrudes in front of the stand plane, so it reads as carved into the structure
 * rather than a box stuck on. Local z=0 is the stand front plane (the surround
 * face); the channel runs back along -z; origin on the ground at the mouth centre.
 */
function buildTunnel(): THREE.Group {
  const g = new THREE.Group();
  const dark = new THREE.MeshBasicMaterial({ color: 0x05080f });
  const floor = new THREE.MeshStandardMaterial({ color: 0x70777e, roughness: 0.96, metalness: 0.03 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x16223c, roughness: 0.8, metalness: 0.18 });

  const LEN = 11;       // channel depth back into the stand
  const SURR_W = 3.25;  // surround half-width — matches the 6.5m gap in the stand wall
  const IN_W = 2.15;    // mouth half-width (4.3m, fits the two walk-out columns)
  const SURR_H = 3.7;   // surround height
  const IN_H = 3.0;     // mouth height
  const TH = 0.3;
  const recess = 0.45;  // the dark mouth is set back behind the surround face -> a visible "cut" lip

  const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  // a branded panel whose cells stay roughly square for a width x height (metres)
  const panel = (w: number, h: number) => {
    const t = brandedPanelTexture();
    t.repeat.set(Math.max(1, Math.round(w / 1.6)), Math.max(1, Math.round(h / 1.6)));
    return new THREE.MeshBasicMaterial({ map: t });
  };

  // --- branded SURROUND, flush in the stand-wall gap (front face at local z = TH/2) ---
  const flankW = SURR_W - IN_W; // branding either side of the mouth
  box(flankW, SURR_H, TH, panel(flankW, SURR_H), -(IN_W + flankW / 2), SURR_H / 2, 0);
  box(flankW, SURR_H, TH, panel(flankW, SURR_H), IN_W + flankW / 2, SURR_H / 2, 0);
  box(IN_W * 2, SURR_H - IN_H, TH, new THREE.MeshBasicMaterial({ map: tunnelHeaderTexture() }),
    0, IN_H + (SURR_H - IN_H) / 2, 0); // branded header lintel over the mouth

  // --- dark recessed channel running back into the stand ---
  const mouthZ = -recess;                 // front of the channel (the cut lip)
  const backZ = -LEN;                      // far end, deep in the stand
  const depth = LEN - recess;
  const midZ = (mouthZ + backZ) / 2;
  box(TH, IN_H, depth, panel(depth, IN_H), -IN_W, IN_H / 2, midZ); // left interior wall
  box(TH, IN_H, depth, panel(depth, IN_H), IN_W, IN_H / 2, midZ);  // right interior wall
  box(IN_W * 2, IN_H, TH, panel(IN_W * 2, IN_H), 0, IN_H / 2, backZ + TH / 2); // branded back wall
  box(IN_W * 2 + TH, TH, depth, dark, 0, IN_H, midZ);   // dark ceiling
  box(IN_W * 2 + TH, TH, depth, floor, 0, TH / 2, midZ); // concrete floor

  // dark reveal frame just inside the surround so the recess reads as a clean cut
  box(IN_W * 2 + 0.05, IN_H + 0.05, TH, dark, 0, IN_H / 2, -recess + TH);

  // gold accent jambs around the mouth + a top cap give a crisp branded edge
  const accent = new THREE.MeshBasicMaterial({ color: 0xffd400 });
  box(0.18, IN_H, 0.3, accent, -(IN_W + 0.09), IN_H / 2, TH / 2);          // left jamb
  box(0.18, IN_H, 0.3, accent, IN_W + 0.09, IN_H / 2, TH / 2);             // right jamb
  box(IN_W * 2 + 0.36, 0.18, 0.3, accent, 0, IN_H + 0.09, TH / 2);         // lintel bar over the mouth
  box(SURR_W * 2, 0.4, 0.45, trim, 0, SURR_H + 0.1, 0);                    // top cap

  return g;
}

function prepareDugout(source: THREE.Group, targetWidth: number): THREE.Group {
  const dugout = source.clone(true);
  const box = new THREE.Box3().setFromObject(dugout);
  const size = new THREE.Vector3();
  box.getSize(size);
  const width = Math.max(size.x, size.z) || 1;
  const s = targetWidth / width;
  dugout.scale.setScalar(s);
  dugout.position.y = -box.min.y * s;
  dugout.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (mat?.emissive) {
        const clone = mat.clone();
        clone.emissive = new THREE.Color(0x000000);
        clone.emissiveMap = null;
        mesh.material = clone;
      }
    }
  });
  return dugout;
}

function buildGoal(s: number): THREE.Group {
  const g = new THREE.Group();
  const postMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const r = 0.07;
  const mkPost = (y: number) => {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(r, r, GOAL_HEIGHT, 8), postMat);
    post.position.set(0, GOAL_HEIGHT / 2, y);
    return post;
  };
  g.add(mkPost(-GOAL_HALF_WIDTH));
  g.add(mkPost(GOAL_HALF_WIDTH));
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(r, r, GOAL_HALF_WIDTH * 2 + r * 2, 8), postMat);
  bar.rotation.x = Math.PI / 2;
  bar.position.set(0, GOAL_HEIGHT, 0);
  g.add(bar);
  // net: simple translucent box behind
  const netMat = new THREE.MeshLambertMaterial({
    color: 0xffffff, transparent: true, opacity: 0.18, side: THREE.DoubleSide,
  });
  const back = new THREE.Mesh(new THREE.PlaneGeometry(GOAL_HALF_WIDTH * 2, GOAL_HEIGHT), netMat);
  back.position.set(s * GOAL_DEPTH, GOAL_HEIGHT / 2, 0);
  back.rotation.y = Math.PI / 2;
  g.add(back);
  const top = new THREE.Mesh(new THREE.PlaneGeometry(GOAL_DEPTH, GOAL_HALF_WIDTH * 2), netMat);
  top.rotation.z = Math.PI / 2;
  top.rotation.y = Math.PI / 2;
  top.position.set(s * GOAL_DEPTH / 2, GOAL_HEIGHT, 0);
  g.add(top);
  for (const sy of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.PlaneGeometry(GOAL_DEPTH, GOAL_HEIGHT), netMat);
    side.position.set(s * GOAL_DEPTH / 2, GOAL_HEIGHT / 2, sy * GOAL_HALF_WIDTH);
    g.add(side);
  }
  g.position.x = s * HALF_LEN;
  return g;
}

export function defaultPitchBoardCreatives(homeName: string): PitchBoardCreative[] {
  return [
    { text: 'SUPER LEAGUE', background: '#0b2a6b', foreground: '#ffd400' },
    { text: homeName.toUpperCase(), background: '#ffd400', foreground: '#0c1118' },
    { text: 'MESHY SPORTS', background: '#141029', foreground: '#7fb4ff' },
    { text: 'FAL RADIO', background: '#7a1530', foreground: '#ffe3ea' },
    { text: 'TOP CORNER COLA', background: '#0a6b4a', foreground: '#d8ffe6' },
    { text: 'INT. CUP 2026', background: '#0c1118', foreground: '#ffd400' },
    { text: 'BOOT ROOM', background: '#241a12', foreground: '#ff9a55' },
  ];
}

export function resolvePitchBoardCreatives(homeName: string, creatives?: PitchBoardCreative[]): PitchBoardCreative[] {
  const usable = creatives?.filter((creative) => (
    creative.text.trim() && creative.background && creative.foreground
  )) ?? [];
  return usable.length ? usable : defaultPitchBoardCreatives(homeName);
}

function buildAdBoards(homeName: string, creatives?: PitchBoardCreative[]): THREE.Group {
  const g = new THREE.Group();
  // each sponsor gets its own coloured LED panel so the hoardings read as a real
  // pitchside advertising run rather than one strip of text on black
  const ads = resolvePitchBoardCreatives(homeName, creatives);
  const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const shade = (hex: string, amt: number) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgb(${clamp255((n >> 16) + amt * 255)},${clamp255(((n >> 8) & 255) + amt * 255)},${clamp255((n & 255) + amt * 255)})`;
  };
  const PANEL = 380, H = 132;
  const canvas = document.createElement('canvas');
  canvas.width = PANEL * ads.length; canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ads.forEach((ad, i) => {
    const x = i * PANEL;
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, shade(ad.background, 0.1)); grad.addColorStop(1, shade(ad.background, -0.28));
    ctx.fillStyle = grad; ctx.fillRect(x, 0, PANEL, H);
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(x + PANEL - 3, 0, 3, H); // panel seam
    ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.fillRect(x, 0, PANEL, 3); // top LED rail sheen
    ctx.fillStyle = ad.foreground;
    ctx.font = '900 58px Arial, "Arial Black", system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(ad.text, x + PANEL / 2, H / 2 + 4);
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  const plinthMat = new THREE.MeshStandardMaterial({ color: 0x0a0e14, roughness: 0.85, metalness: 0.2 });
  const panels: { mat: THREE.MeshStandardMaterial; len: number }[] = [];
  const mk = (len: number) => {
    const board = new THREE.Group();
    const m = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.1 });
    m.map = tex.clone(); m.map.repeat.set(len / 72, 1); m.map.needsUpdate = true;
    // self-lit so the sponsors stay readable in floodlight and at dusk
    m.emissiveMap = m.map; m.emissive = new THREE.Color(0xffffff); m.emissiveIntensity = 0.55;
    const panel = new THREE.Mesh(new THREE.BoxGeometry(len, 1.05, 0.12), m);
    panel.position.y = 0.72;
    board.add(panel);
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(len, 0.4, 0.34), plinthMat);
    plinth.position.y = 0.2;
    board.add(plinth);
    panels.push({ mat: m, len });
    return board;
  };
  // north touchline: split the run into two so the boards stop before, and start
  // after, the tunnel + dugouts sat between them (no boards cutting through them)
  const NORTH_GAP = 19;
  const northHalf = HALF_LEN + 4;
  const northSeg = northHalf - NORTH_GAP;
  for (const sgn of [-1, 1]) {
    const seg = mk(northSeg);
    seg.position.set(sgn * (NORTH_GAP + northSeg / 2), 0, -HALF_WID - 3.4);
    g.add(seg);
  }
  const b2 = mk(HALF_LEN * 2 + 8);
  b2.position.set(0, 0, HALF_WID + 3.4);
  b2.rotation.y = Math.PI;
  g.add(b2);
  for (const s of [-1, 1]) {
    const b = mk(HALF_WID * 2);
    b.position.set(s * (HALF_LEN + 3.4), 0, 0);
    b.rotation.y = s > 0 ? -Math.PI / 2 : Math.PI / 2;
    g.add(b);
  }
  // upgrade the procedural panels to the generated fake-brand artwork once it loads
  new THREE.TextureLoader().load(
    `${import.meta.env.BASE_URL}assets/ui/adboards.webp`,
    (loaded) => {
      loaded.colorSpace = THREE.SRGBColorSpace;
      loaded.wrapS = THREE.RepeatWrapping;
      loaded.anisotropy = 8;
      for (const { mat, len } of panels) {
        const map = loaded.clone();
        map.wrapS = THREE.RepeatWrapping;
        map.repeat.set(len / 45, 1);
        map.needsUpdate = true;
        mat.map = map;
        mat.emissiveMap = map;
        mat.emissiveIntensity = 0.42;
        mat.needsUpdate = true;
      }
    },
    undefined,
    () => { /* keep the procedural fallback if the artwork is missing */ },
  );
  return g;
}

function buildFloodlight(x: number, z: number, lit: boolean): THREE.Group {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.35, 0.5, 26, 8),
    new THREE.MeshLambertMaterial({ color: 0x39424e }),
  );
  pole.position.y = 13;
  g.add(pole);
  const head = new THREE.Mesh(
    new THREE.BoxGeometry(4.4, 3, 0.8),
    new THREE.MeshBasicMaterial({ color: lit ? 0xffffe8 : 0xb9c1cc }),
  );
  head.position.y = 27;
  head.lookAt(new THREE.Vector3(0, 2, 0).sub(new THREE.Vector3(x, 0, z)).add(head.position));
  g.add(head);
  if (lit) {
    // soft additive beam angled at the pitch
    const beam = new THREE.Mesh(
      new THREE.ConeGeometry(10, 32, 20, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xfff7d9, transparent: true, opacity: 0.055,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
      }),
    );
    beam.position.y = 27;
    const aim = new THREE.Vector3(-x * 0.62, 0, -z * 0.62);
    beam.lookAt(aim.clone().add(new THREE.Vector3(x, 0, z)));
    beam.rotateX(-Math.PI / 2);
    beam.translateY(-16);
    g.add(beam);
  }
  g.position.set(x, 0, z);
  return g;
}

/** gradient sky dome; weather overrides the palette with overcast greys */
function buildSkyDome(opts: StadiumOptions): THREE.Mesh {
  const overcast = opts.weather === 'rain' || opts.weather === 'snow';
  const c = document.createElement('canvas');
  c.width = 64; c.height = 512;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 0, 512);
  if (overcast) {
    if (opts.timeOfDay === 'night') { grad.addColorStop(0, '#11151d'); grad.addColorStop(0.7, '#232a35'); grad.addColorStop(1, '#39414d'); }
    else if (opts.timeOfDay === 'evening') { grad.addColorStop(0, '#3a3f50'); grad.addColorStop(0.7, '#6b6877'); grad.addColorStop(1, '#9b8d8e'); }
    else { grad.addColorStop(0, '#7d8893'); grad.addColorStop(0.65, '#a8b1ba'); grad.addColorStop(1, '#cfd5da'); }
  } else if (opts.timeOfDay === 'night') {
    grad.addColorStop(0, '#04070f'); grad.addColorStop(0.6, '#0a1322'); grad.addColorStop(1, '#1d2c44');
  } else if (opts.timeOfDay === 'evening') {
    grad.addColorStop(0, '#27355f'); grad.addColorStop(0.55, '#7e5a7a'); grad.addColorStop(0.82, '#e08a52'); grad.addColorStop(1, '#f6c590');
  } else {
    grad.addColorStop(0, '#3f87cf'); grad.addColorStop(0.65, '#86b9e8'); grad.addColorStop(1, '#d6eaf8');
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 512);
  if (opts.timeOfDay === 'night' && !overcast) {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (let i = 0; i < 90; i++) {
      const sx = Math.random() * 64, sy = Math.random() * 300;
      ctx.globalAlpha = 0.25 + Math.random() * 0.6;
      ctx.fillRect(sx, sy, 1, 1);
    }
    ctx.globalAlpha = 1;
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(290, 24, 12),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false }),
  );
  dome.position.y = -8;
  return dome;
}

/** concrete walkways ringing the pitch so the surrounds read as a real ground */
function buildWalkways(sizeX: number, sizeZ: number, weather: StadiumWeather): THREE.Group {
  const g = new THREE.Group();
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d')!;
  const base = weather === 'snow' ? '#dde4ea' : weather === 'ice' ? '#c4d2dc' : weather === 'rain' ? '#7c838a' : '#a3a9ae';
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 64);
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = 2;
  for (let x = 0; x <= 256; x += 32) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 64); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  const mat = new THREE.MeshLambertMaterial({ map: tex });
  // width w runs along x, depth d along z — no rotation games
  const strip = (w: number, d: number, x: number, z: number) => {
    const m = mat.clone();
    m.map = tex.clone();
    m.map!.repeat.set(Math.max(1, w / 6), Math.max(1, d / 6));
    m.map!.needsUpdate = true;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), m);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.012, z);
    return mesh;
  };
  // walkway ring just outside the apron
  g.add(strip(sizeX + 7, 2.8, 0, -(sizeZ / 2 + 1.4)));
  g.add(strip(sizeX + 7, 2.8, 0, sizeZ / 2 + 1.4));
  g.add(strip(2.8, sizeZ + 7, -(sizeX / 2 + 1.4), 0));
  g.add(strip(2.8, sizeZ + 7, sizeX / 2 + 1.4, 0));
  // tunnel pad behind the dugouts
  g.add(strip(10, 4.5, 0, sizeZ / 2 + 4.4));
  return g;
}

function makeCrowdTexture(profile: StadiumRenderProfile): THREE.Texture {
  // higher-res canvas for a denser, more lifelike packed terrace
  const SZ = 512;
  const c = document.createElement('canvas');
  c.width = SZ; c.height = SZ;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#1d222c';
  ctx.fillRect(0, 0, SZ, SZ);

  const rng = mulberry32(Math.round(profile.crowdFill * 1000) + Math.round(profile.emptySeatAlpha * 10000));
  // tiered seating: alternating row shades with a dark step line between rows
  const rowH = 13;
  ctx.globalAlpha = profile.emptySeatAlpha;
  for (let y = 0, r = 0; y < SZ; y += rowH, r++) {
    ctx.fillStyle = r % 2 === 0 ? '#182433' : '#1c2939';
    ctx.fillRect(0, y, SZ, rowH - 2);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(0, y + rowH - 2, SZ, 1.5);
  }
  ctx.globalAlpha = 1;

  // each spectator = a clothing body + a skin-tone head, so the crowd reads as
  // people rather than flat dots; wide hue variety gives a real terrace mix
  const skin = ['#e8b48c', '#cf9468', '#b07644', '#8c5630', '#f0c9a6', '#6f4327'];
  const people = Math.round(8600 * profile.crowdFill);
  for (let i = 0; i < people; i++) {
    const x = rng() * SZ;
    const y = rng() * (SZ - 5) + 2;
    const w = 2.4 + rng() * 2.0;
    const h = 3.0 + rng() * 2.8;
    ctx.fillStyle = `hsl(${(rng() * 360) | 0}, ${(12 + rng() * 55) | 0}%, ${(26 + rng() * 46) | 0}%)`;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = skin[(rng() * skin.length) | 0];
    ctx.fillRect(x + w * 0.22, y - h * 0.36, w * 0.56, h * 0.4);
  }
  // bright specks — pale shirts, phone screens, flags — to sparkle the stand
  const specks = Math.round(900 * profile.crowdFill);
  for (let i = 0; i < specks; i++) {
    ctx.fillStyle = rng() > 0.5 ? 'rgba(250,250,240,0.85)' : 'rgba(255,224,120,0.7)';
    ctx.fillRect(rng() * SZ, rng() * SZ, 1.5, 1.5);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
