import * as THREE from 'three';
import { BALL_RADIUS, HALF_LEN, HALF_WID } from '../sim/constants';
import type { KitColors, MatchConfig, MatchState, MatchTimeOfDay, MatchWeather } from '../sim/types';
import type { GameAssets } from './assets';
import {
  resolveAppearance,
  resolveKitStyle,
  shirtNumberForPlayer,
  visualManifestKey,
  type KitSide,
} from './appearance';
import { goalkeeperKit } from './kitTint';
import { PlayerFactory, setMatchPlayerShaderEnabled, gpuHandlesMatchPlayerShader, type PlayerVisual } from './playerVisuals';
import { buildStadium, type PitchBoardCreative } from './stadium';

export interface RenderCameraMode {
  replay?: boolean;
  /** fixed replay camera position (set by the replay controller) — held while the
   * look-at pans to follow the ball */
  pos?: { x: number; y: number; z: number };
  fov?: number;
  zoom?: number;
  angle?: number;
  presentation?: 'walkout' | 'halfTimeExit' | 'fullTimeExit' | 'winnerCelebration' | 'trophyLift' | 'substitution';
  presentationFocus?: { x: number; y: number };
  pyro?: boolean;
  setPiece?: boolean;
  /** Player Career: a global player index to track instead of the ball (Be-A-Pro cam). */
  focusPlayerIdx?: number;
}

/**
 * Whether this GPU can be trusted with the custom player-shading shader chunk.
 * Qualcomm Adreno (Snapdragon Windows-on-ARM / Copilot+ PCs) and software
 * renderers compile-fail or NaN on the injected chunk and draw every player solid
 * black, so we disable the flourish on them. If the renderer string can't be read
 * we assume it's fine — desktop/laptop GPUs handle it without issue.
 */
function matchPlayerShaderSupported(renderer: THREE.WebGLRenderer): boolean {
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const raw = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
    return gpuHandlesMatchPlayerShader(String(raw || ''));
  } catch {
    return true;
  }
}

/** Three.js view of a MatchState. Pure consumer: never mutates sim state. */
export class MatchRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private playerVisuals: PlayerVisual[] = [];
  private ball!: THREE.Group;
  private ballMesh!: THREE.Mesh;
  /** smoothed (rendered) ball ground position — lags the sim ball only across a sudden
   * snap (e.g. a keeper claiming a save) so it slides in rather than teleporting. */
  private _renderBallX = 0;
  private _renderBallZ = 0;
  private _renderBallInit = false;
  private _ballHandA = new THREE.Vector3();
  private _ballHandB = new THREE.Vector3();
  private camTarget = new THREE.Vector3();
  private camPos = new THREE.Vector3(0, 46, 20);
  private shake = 0;
  /** was the previous frame a goal replay? lets the replay camera snap onto the
   * ball on its first frame, then ease-follow it after */
  private replayWasActive = false;
  private factory: PlayerFactory;
  private disposed = false;
  private precipitation: THREE.Points | null = null;
  private precipitationSpeed = 0;
  private aimArrow: THREE.Group | null = null;
  private aimArrowMats: THREE.MeshBasicMaterial[] = [];
  private isTouch = window.matchMedia('(pointer: coarse)').matches;
  // pyrotechnics (walk-out + trophy lift) + the celebration trophy
  private pyro: THREE.Points | null = null;
  private pyroVel = new Float32Array(0);
  private pyroLife = new Float32Array(0);
  private pyroMaxLife = new Float32Array(0);
  private pyroBase = new Float32Array(0);
  private pyroCursor = 0;
  private pyroActive = false;
  private pyroEmitters: THREE.Vector3[] = [];
  private readonly pyroPalette = [[1, 0.85, 0.3], [1, 0.32, 0.22], [0.42, 0.7, 1], [1, 1, 1], [0.5, 1, 0.45], [1, 0.42, 0.9]];
  private trophyObj: THREE.Group | null = null;
  private trophyPodium: THREE.Group | null = null;
  private trophyLift = 0;

  constructor(canvas: HTMLCanvasElement, private assets: GameAssets) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // Some GPUs render every player solid black with our custom player shader chunk
    // (Qualcomm Adreno on Snapdragon Windows-on-ARM, software fallbacks). Detect them
    // and fall back to plain — but correct — player materials.
    setMatchPlayerShaderEnabled(matchPlayerShaderSupported(this.renderer));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera = new THREE.PerspectiveCamera(38, 16 / 9, 1, 400);
    this.factory = new PlayerFactory(assets);
    this.onResize();
    window.addEventListener('resize', this.onResize);
  }

  private onResize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  setup(cfg: MatchConfig, kits: [KitColors, KitColors], opts: { adBoardCreatives?: PitchBoardCreative[] } = {}) {
    this.scene.clear();
    this.playerVisuals = [];
    const timeOfDay: MatchTimeOfDay = cfg.timeOfDay ?? 'day';
    const weather: MatchWeather = cfg.weather ?? 'normal';
    const overcast = weather === 'rain' || weather === 'snow';

    // atmosphere: the sky dome supplies the backdrop; fog tones match it
    const fogColor = overcast
      ? (timeOfDay === 'night' ? 0x171c24 : 0x99a2ab)
      : timeOfDay === 'night' ? 0x0a1322 : timeOfDay === 'evening' ? 0x4a3c55 : 0x9cc3e6;
    this.scene.background = new THREE.Color(fogColor);
    this.scene.fog = new THREE.Fog(fogColor, overcast ? 120 : 160, overcast ? 260 : 320);

    const hemiPreset = timeOfDay === 'night'
      ? { sky: 0x9fb4d8, ground: 0x1c2430, intensity: 0.62 }
      : timeOfDay === 'evening'
        ? { sky: 0xffd9b0, ground: 0x33302a, intensity: 0.78 }
        : { sky: 0xcfe8ff, ground: 0x2a4a2e, intensity: 0.95 };
    const hemi = new THREE.HemisphereLight(hemiPreset.sky, hemiPreset.ground, hemiPreset.intensity + (overcast ? 0.12 : 0));
    this.scene.add(hemi);
    const sunPreset = timeOfDay === 'night'
      ? { color: 0xf2f6ff, intensity: 1.5, pos: [-22, 80, 16] as const } // floodlight key
      : timeOfDay === 'evening'
        ? { color: 0xffb066, intensity: 1.35, pos: [-70, 34, 26] as const } // low warm sun, long shadows
        : { color: 0xfff2da, intensity: 1.6, pos: [-40, 70, 30] as const };
    const sun = new THREE.DirectionalLight(sunPreset.color, sunPreset.intensity * (overcast ? 0.55 : 1));
    sun.position.set(sunPreset.pos[0], sunPreset.pos[1], sunPreset.pos[2]);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -75;
    sun.shadow.camera.right = 75;
    sun.shadow.camera.top = 75;
    sun.shadow.camera.bottom = -75;
    sun.shadow.camera.far = 240;
    sun.shadow.bias = -0.0006;
    this.scene.add(sun);

    const stadium = buildStadium(this.assets, cfg.teams[0].data.name, {
      timeOfDay,
      weather,
      venueProfile: cfg.venueProfile,
      crowdDensity: cfg.crowdDensity,
      adBoardCreatives: opts.adBoardCreatives,
    });
    this.scene.add(stadium.group);
    this.buildPrecipitation(weather);
    this.trophyObj = null;
    this.trophyPodium = null;
    this.trophyLift = 0;
    this.buildPyro();

    // players: GK gets a distinct kit
    const gkKit = goalkeeperKit(kits[0], kits[1]);
    for (let t = 0; t < 2; t++) {
      const team = cfg.teams[t].data;
      const selectedKitSide = kits[t] === team.colors.away ? 'away' : 'home';
      for (let i = 0; i < 11; i++) {
        const squadIdx = cfg.teams[t].lineup.starters[i];
        const attrs = team.players[squadIdx];
        const side: KitSide = i === 0 ? 'gk' : selectedKitSide;
        const kit = i === 0 ? gkKit : kits[t];
        const sourceStyle = {
          ...(side !== 'gk' ? team.visuals?.kitStyles?.[side] : undefined),
          ...kit.style,
        };
        const defaultBadgeKey = visualManifestKey('badge', team.id);
        if (!sourceStyle.badgeAssetKey && this.assets.visualTextures[defaultBadgeKey]) sourceStyle.badgeAssetKey = defaultBadgeKey;
        if (!sourceStyle.badgeAssetKey && team.visuals?.badgeAssetKey) sourceStyle.badgeAssetKey = team.visuals.badgeAssetKey;
        delete sourceStyle.kitAssetKey;
        const styledKit = { ...kit, style: sourceStyle };
        const kitStyle = resolveKitStyle(styledKit, team.id, side, team.short);
        const v = this.factory.create({
          kit: styledKit,
          appearance: resolveAppearance(attrs, team.id, squadIdx),
          kitStyle,
          shirtNumber: shirtNumberForPlayer({ squadIdx, attrs }),
          teamId: team.id,
          side,
          badgeTexture: kitStyle.badgeAssetKey ? this.assets.visualTextures[kitStyle.badgeAssetKey] : undefined,
        });
        // away ring is cyan to tell teams apart at a glance
        (v.ring.material as THREE.MeshBasicMaterial).color.set(t === 0 ? 0xffe24a : 0x6be8ff);
        this.scene.add(v.group);
        this.playerVisuals.push(v);
      }
    }

    // ball
    this.ball = new THREE.Group();
    this.ballMesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(BALL_RADIUS * 1.6, 1), // mildly oversized for readability, but in proportion
      new THREE.MeshStandardMaterial({ map: makeBallTexture(weather === 'snow' || weather === 'ice' ? '#f07818' : '#f4f4f4'), roughness: 0.5, flatShading: false }),
    );
    this.ballMesh.castShadow = true;
    this.ball.add(this.ballMesh);
    const blob = new THREE.Mesh(
      new THREE.CircleGeometry(0.3, 14),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3 }),
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.025;
    this.ball.add(blob);
    this.scene.add(this.ball);

    this.camPos.set(0, 46, 20);
    this.buildAimArrow();
  }

  /** flat ground arrow shown while lining up a corner / throw / free kick */
  private buildAimArrow() {
    const group = new THREE.Group();
    const mat = () => {
      const m = new THREE.MeshBasicMaterial({
        color: 0xffe24a, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide,
      });
      this.aimArrowMats.push(m);
      return m;
    };
    this.aimArrowMats = [];
    const shaft = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 0.38), mat());
    shaft.rotation.x = -Math.PI / 2;
    shaft.position.set(3.1, 0.06, 0);
    group.add(shaft);
    const headShape = new THREE.Shape();
    headShape.moveTo(0, -0.85);
    headShape.lineTo(1.5, 0);
    headShape.lineTo(0, 0.85);
    headShape.closePath();
    const head = new THREE.Mesh(new THREE.ShapeGeometry(headShape), mat());
    head.rotation.x = -Math.PI / 2;
    head.position.set(5.5, 0.06, 0);
    group.add(head);
    group.visible = false;
    this.aimArrow = group;
    this.scene.add(group);
  }

  /** dir is in sim coordinates (x along pitch, y across); charge 0..1 reddens and stretches it */
  setAimIndicator(info: { x: number; y: number; dirX: number; dirY: number; charge: number } | null) {
    if (!this.aimArrow) return;
    if (!info) {
      this.aimArrow.visible = false;
      return;
    }
    this.aimArrow.visible = true;
    this.aimArrow.position.set(info.x, 0, info.y);
    this.aimArrow.rotation.y = -Math.atan2(info.dirY, info.dirX);
    const stretch = 0.85 + info.charge * 0.55;
    this.aimArrow.scale.set(stretch, 1, 1);
    const c = new THREE.Color().lerpColors(new THREE.Color(0xffe24a), new THREE.Color(0xff4422), info.charge);
    for (const m of this.aimArrowMats) m.color.copy(c);
  }

  goalShake() {
    this.shake = 0.8;
  }

  /** camera forward projected onto the pitch, in sim coordinates (x, y) */
  getGroundForward(): { x: number; y: number } {
    const dx = this.camTarget.x - this.camPos.x;
    const dy = this.camTarget.z - this.camPos.z;
    const len = Math.hypot(dx, dy) || 1;
    return { x: dx / len, y: dy / len };
  }

  /** cheap falling-particle field that tracks the camera target */
  private buildPrecipitation(weather: MatchWeather) {
    this.precipitation = null;
    if (weather !== 'rain' && weather !== 'snow') return;
    const count = weather === 'rain' ? 1500 : 900;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 110;
      positions[i * 3 + 1] = Math.random() * 42;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 70;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: weather === 'rain' ? 0xa9c4e0 : 0xffffff,
      size: weather === 'rain' ? 0.16 : 0.3,
      transparent: true,
      opacity: weather === 'rain' ? 0.55 : 0.9,
      depthWrite: false,
      fog: false,
    });
    this.precipitation = new THREE.Points(geo, mat);
    this.precipitationSpeed = weather === 'rain' ? 30 : 3.2;
    this.scene.add(this.precipitation);
  }

  private updatePrecipitation(dt: number) {
    if (!this.precipitation) return;
    const attr = (this.precipitation.geometry as THREE.BufferGeometry).getAttribute('position') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    const sway = this.precipitationSpeed < 10 ? Math.sin(performance.now() * 0.0006) * 0.8 : 0;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i + 1] -= this.precipitationSpeed * dt * (0.8 + ((i / 3) % 5) * 0.1);
      arr[i] += sway * dt;
      if (arr[i + 1] < 0) {
        arr[i + 1] = 40 + Math.random() * 4;
        arr[i] = this.camTarget.x + (Math.random() - 0.5) * 110;
        arr[i + 2] = this.camTarget.z + (Math.random() - 0.5) * 70;
      }
    }
    attr.needsUpdate = true;
  }

  private buildPyro() {
    const MAX = 900;
    const pos = new Float32Array(MAX * 3);
    const col = new Float32Array(MAX * 3);
    this.pyroVel = new Float32Array(MAX * 3);
    this.pyroLife = new Float32Array(MAX);
    this.pyroMaxLife = new Float32Array(MAX);
    this.pyroBase = new Float32Array(MAX * 3);
    this.pyroCursor = 0;
    this.pyroActive = false;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.6, vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, fog: false,
    });
    this.pyro = new THREE.Points(geo, mat);
    this.pyro.frustumCulled = false;
    this.scene.add(this.pyro);
  }

  /** Spark-fountain pyrotechnics: upward jets from the emitter points that arc and fade. */
  private updatePyro(dt: number) {
    if (!this.pyro) return;
    const geo = this.pyro.geometry as THREE.BufferGeometry;
    const pos = (geo.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    const col = (geo.getAttribute('color') as THREE.BufferAttribute).array as Float32Array;
    const MAX = this.pyroLife.length;
    const GRAV = 13;
    if (this.pyroActive && this.pyroEmitters.length) {
      for (let n = 0; n < 16; n++) {
        const i = this.pyroCursor; this.pyroCursor = (this.pyroCursor + 1) % MAX;
        const e = this.pyroEmitters[(Math.random() * this.pyroEmitters.length) | 0];
        pos[i * 3] = e.x + (Math.random() - 0.5) * 0.8;
        pos[i * 3 + 1] = e.y + Math.random() * 0.4;
        pos[i * 3 + 2] = e.z + (Math.random() - 0.5) * 0.8;
        this.pyroVel[i * 3] = (Math.random() - 0.5) * 4.5;
        this.pyroVel[i * 3 + 1] = 9 + Math.random() * 7;
        this.pyroVel[i * 3 + 2] = (Math.random() - 0.5) * 4.5;
        const c = this.pyroPalette[(Math.random() * this.pyroPalette.length) | 0];
        this.pyroBase[i * 3] = c[0]; this.pyroBase[i * 3 + 1] = c[1]; this.pyroBase[i * 3 + 2] = c[2];
        this.pyroMaxLife[i] = 1.0 + Math.random() * 0.9;
        this.pyroLife[i] = this.pyroMaxLife[i];
      }
    }
    for (let i = 0; i < MAX; i++) {
      if (this.pyroLife[i] > 0) {
        this.pyroVel[i * 3 + 1] -= GRAV * dt;
        pos[i * 3] += this.pyroVel[i * 3] * dt;
        pos[i * 3 + 1] += this.pyroVel[i * 3 + 1] * dt;
        pos[i * 3 + 2] += this.pyroVel[i * 3 + 2] * dt;
        this.pyroLife[i] -= dt;
        const b = 1.6 * Math.max(0, this.pyroLife[i] / this.pyroMaxLife[i]);
        col[i * 3] = this.pyroBase[i * 3] * b;
        col[i * 3 + 1] = this.pyroBase[i * 3 + 1] * b;
        col[i * 3 + 2] = this.pyroBase[i * 3 + 2] * b;
      } else {
        col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = 0;
      }
    }
    (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }

  /** The 3D trophy, presented on a podium over the celebration. */
  private showTrophyLift(dt: number) {
    if (!this.assets.trophy) return;
    if (!this.trophyObj) {
      const t = this.assets.trophy.clone(true);
      const box = new THREE.Box3().setFromObject(t);
      const size = new THREE.Vector3(); box.getSize(size);
      const s = 2.0 / (size.y || 1);
      t.scale.setScalar(s);
      const wrap = new THREE.Group();
      wrap.add(t);
      const box2 = new THREE.Box3().setFromObject(wrap);
      t.position.y = -box2.min.y; // trophy base sits at the wrap's origin
      t.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.castShadow = true; });
      this.trophyObj = wrap;
      this.scene.add(this.trophyObj);
      this.trophyPodium = this.buildTrophyPodium();
      this.trophyPodium.position.set(0, 0, 6);
      this.scene.add(this.trophyPodium);
    }
    this.trophyObj.visible = true;
    if (this.trophyPodium) this.trophyPodium.visible = true;
    // rests on the podium cap (no hovering) and turns slowly to catch the light.
    this.trophyObj.position.set(0, 1.6, 6);
    this.trophyObj.rotation.y += dt * 0.5;
  }

  /** A tiered presentation plinth the trophy is set down on. */
  private buildTrophyPodium(): THREE.Group {
    const g = new THREE.Group();
    const tier = (rTop: number, rBot: number, h: number, y: number, color: number, metal = 0.1, rough = 0.7) => {
      const m = new THREE.Mesh(
        new THREE.CylinderGeometry(rTop, rBot, h, 40),
        new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }),
      );
      m.position.y = y;
      m.castShadow = true; m.receiveShadow = true;
      g.add(m);
    };
    tier(1.55, 1.75, 0.55, 0.275, 0x1b2440);   // base
    tier(1.2, 1.32, 0.55, 0.825, 0x232f54);    // middle
    tier(0.98, 1.05, 0.45, 1.27, 0x2c3a6a);    // top
    tier(1.02, 1.02, 0.09, 1.54, 0xd9a52a, 0.6, 0.35); // gold cap the trophy rests on
    return g;
  }

  render(state: MatchState, dt: number, cameraMode: RenderCameraMode = {}) {
    if (this.disposed) return;
    // smooth out sim position snaps (a keeper aligned to the ball on a save) only during
    // live play — restarts/replays should place players instantly.
    const smoothPlayers = state.phase === 'play' && !cameraMode.replay;
    for (let i = 0; i < this.playerVisuals.length && i < state.players.length; i++) {
      this.factory.update(this.playerVisuals[i], state.players[i], dt, !!cameraMode.replay, smoothPlayers);
    }
    // ball — during a throw-in hold, draw it in the thrower's raised hands
    // (the sim keeps it on the line for the restart rules)
    const b = state.ball;
    let ballX = b.pos.x;
    let ballZ = b.pos.y;
    let ballH = b.z;
    if (state.phase === 'throwIn') {
      let taker = null as MatchState['players'][number] | null;
      let bd = Infinity;
      for (const p of state.players) {
        if (p.team !== state.restartTeam || p.sentOff || p.isGK) continue;
        const d = Math.hypot(p.pos.x - state.restartPos.x, p.pos.y - state.restartPos.y);
        if (d < bd) { bd = d; taker = p; }
      }
      if (taker && bd < 3.2) {
        // hold the ball in his raised hands directly ABOVE his head, not out in
        // front of his face: same ground spot as the thrower, lifted clear of the
        // ~1.92m head so it sits up in the overhead-arms pose
        ballX = taker.pos.x;
        ballZ = taker.pos.y;
        ballH = Math.max(ballH, 2.06);
      }
    }
    // a caught ball is carried in the keeper's hands in front of his chest. The
    // sim already lerps b.z to hand height (chest standing, low when sprawled), so
    // track it rather than forcing a fixed floor that would float the ball above a
    // diving keeper's body.
    if (b.held && b.ownerIdx >= 0) {
      const gk = state.players[b.ownerIdx];
      const gv = this.playerVisuals[b.ownerIdx];
      const sprawled = !!gk && (gk.diving || gk.anim === 'dive' || gk.anim === 'smother'
        || (!!gv && (gv.recoverTime ?? 0) > 0));
      // runOut is LATCHED on the visual (the sim clears gk.diveKind mid-hold, which otherwise
      // dropped a still-sliding smother into the lateral/hands branch — the ball trailing off
      // to his side).
      const runOut = !!gv && !!gv.diveRunOut;
      const recovering = !!gv && gv.current === 'recover';
      if (sprawled && runOut && gk && gv) {
        // A rush-out smother/spread lies face-down ON the ball. Carry it at his BODY CENTRE
        // (midpoint of hips and chest) so it sits under his belly however he's laid out —
        // his ground spot alone is at his hips and can be a metre off his forward-thrown
        // chest on a spread. Clamp it near the ground spot so a stray bone pose can't fling
        // it away, and keep it low.
        const hips = gv.group.getObjectByName('Hips');
        const chest = gv.group.getObjectByName('Spine1') ?? gv.group.getObjectByName('Spine');
        if (hips && chest) {
          const a = this._ballHandA; const c = this._ballHandB;
          hips.getWorldPosition(a); chest.getWorldPosition(c);
          let cx = (a.x + c.x) / 2, cz = (a.z + c.z) / 2;
          const dx = cx - gk.pos.x, dz = cz - gk.pos.y;
          const d = Math.hypot(dx, dz);
          if (d > 0.6) { cx = gk.pos.x + dx / d * 0.6; cz = gk.pos.y + dz / d * 0.6; }
          ballX = cx; ballZ = cz; ballH = 0.28;
        } else {
          const visFacing = gv.baseRotY - gv.visualRotY;
          ballX = gk.pos.x + Math.cos(visFacing) * 0.18;
          ballZ = gk.pos.y + Math.sin(visFacing) * 0.18;
          ballH = 0.28;
        }
      } else if (sprawled && recovering && gv && gk) {
        // Getting up after a lateral save: clamp the ball to his CHEST (torso centre, between
        // head and hips) so it rises with him, secured to his body — not jittering around to
        // his side with his planting hands as he stands.
        const head = gv.group.getObjectByName('Head');
        const hips = gv.group.getObjectByName('Hips');
        if (head && hips) {
          const a = this._ballHandA; const c = this._ballHandB;
          head.getWorldPosition(a); hips.getWorldPosition(c);
          const visFacing = gv.baseRotY - gv.visualRotY;
          ballX = (a.x + c.x) / 2 + Math.cos(visFacing) * 0.18;
          ballZ = (a.z + c.z) / 2 + Math.sin(visFacing) * 0.18;
          ballH = Math.max(0.2, (a.y + c.y) / 2);
        }
      } else if (sprawled && gv) {
        // A LATERAL dive reaches both hands at the ball — carry it in his ACTUAL hands (from
        // the rig) so it makes contact with him instead of floating on the ring at his feet.
        const a = this._ballHandA.set(gk.pos.x, 1, gk.pos.y);
        const c = this._ballHandB.set(gk.pos.x, 1, gk.pos.y);
        const lh = gv.group.getObjectByName('LeftHand');
        const rh = gv.group.getObjectByName('RightHand');
        if (lh) lh.getWorldPosition(a);
        if (rh) rh.getWorldPosition(c);
        if (lh && !rh) c.copy(a);
        if (rh && !lh) a.copy(c);
        if (lh || rh) {
          ballX = (a.x + c.x) / 2;
          ballZ = (a.z + c.z) / 2;
          ballH = Math.max(0.12, (a.y + c.y) / 2);
        }
      } else if (gk) {
        // standing hold: in front of the keeper's ACTUAL rendered body. During recover his body
        // holds the dive yaw while gk.facing (sim) is forced upfield — using gk.facing put the
        // ball off to the side. Derive his facing from the visual yaw instead.
        const visFacing = gv ? gv.baseRotY - gv.visualRotY : gk.facing;
        ballX = gk.pos.x + Math.cos(visFacing) * 0.38;
        ballZ = gk.pos.y + Math.sin(visFacing) * 0.38;
      }
    }
    // when the ball is close to a diving keeper, clamp its rendered height so
    // the save reads as contact: ball and keeper occupy the same visual plane
    if (!b.held) {
      for (const p of state.players) {
        if (!p.isGK || p.sentOff || (p.anim !== 'dive' && p.anim !== 'smother')) continue;
        const dx = p.pos.x - b.pos.x;
        const dy = p.pos.y - b.pos.y;
        if (dx * dx + dy * dy < 4.0) { // within ~2m
          // keeper's visual reach height when fully stretched sideways is ~0.9m
          ballH = Math.min(ballH, 0.9);
          break;
        }
      }
    }
    // Render-side smoothing: the sim snaps the ball onto the keeper in a single tick when
    // he claims a save/smother/gather. Ease the RENDERED ball to that spot over a few frames
    // so it slides into his hands instead of teleporting. The cap tracks the ball's own
    // velocity (so genuine fast motion is never held back) plus a fixed catch-up so a snap
    // closes in ~3-5 frames. Restarts / non-play phases place it instantly.
    if (!this._renderBallInit || state.phase !== 'play') {
      this._renderBallX = ballX;
      this._renderBallZ = ballZ;
      this._renderBallInit = true;
    } else {
      const bdx = ballX - this._renderBallX;
      const bdz = ballZ - this._renderBallZ;
      const bgap = Math.hypot(bdx, bdz);
      const cap = (Math.hypot(b.vel.x, b.vel.y) + 26) * dt;
      if (bgap > cap && bgap > 1e-4) {
        this._renderBallX += (bdx / bgap) * cap;
        this._renderBallZ += (bdz / bgap) * cap;
      } else {
        this._renderBallX = ballX;
        this._renderBallZ = ballZ;
      }
    }
    this.ball.position.set(this._renderBallX, 0, this._renderBallZ);
    this.ballMesh.position.y = ballH + BALL_RADIUS * 1.6;
    const speed = Math.hypot(b.vel.x, b.vel.y);
    this.ballMesh.rotation.x += speed * dt * 1.4;
    this.ballMesh.rotation.z += b.vel.y * dt * 0.6;

    // camera: classic high top-down with a touch of tilt, leading the ball.
    const lead = 0.32;
    let tx = THREE.MathUtils.clamp(b.pos.x + b.vel.x * lead, -46, 46);
    let tz = THREE.MathUtils.clamp(b.pos.y + b.vel.y * lead, -26, 26);
    // Player Career: track the avatar instead of the ball for a Be-A-Pro camera.
    if (cameraMode.focusPlayerIdx != null) {
      const fp = state.players[cameraMode.focusPlayerIdx];
      if (fp) { tx = THREE.MathUtils.clamp(fp.pos.x, -46, 46); tz = THREE.MathUtils.clamp(fp.pos.y, -26, 26); }
    }
    this.pyroActive = false;
    if (this.trophyObj && cameraMode.presentation !== 'trophyLift') {
      this.trophyObj.visible = false; this.trophyLift = 0;
      if (this.trophyPodium) this.trophyPodium.visible = false;
    }
    if (cameraMode.presentation) {
      const mode = cameraMode.presentation;
      this.setCameraFov(mode === 'walkout' ? 34 : mode === 'trophyLift' ? 36 : mode === 'substitution' ? 30 : 32);
      let presentationTarget: THREE.Vector3;
      let desired: THREE.Vector3;
      if (mode === 'walkout') {
        // tunnel mouth, side-on + elevated; pyro jets either side of the tunnel
        presentationTarget = new THREE.Vector3(0, 1.6, -HALF_WID - 2);
        desired = new THREE.Vector3(-30, 10.5, -16);
        this.pyroActive = cameraMode.pyro !== false;
        this.pyroEmitters = [
          new THREE.Vector3(-11, 0.3, -HALF_WID - 1.5), new THREE.Vector3(11, 0.3, -HALF_WID - 1.5),
          new THREE.Vector3(-23, 0.3, -HALF_WID - 0.5), new THREE.Vector3(23, 0.3, -HALF_WID - 0.5),
        ];
      } else if (mode === 'trophyLift' || mode === 'winnerCelebration') {
        // winners' celebration; trophyLift also renders the cup and podium
        presentationTarget = new THREE.Vector3(0, 2.6, 6);
        desired = new THREE.Vector3(-6, 7, 34);
        this.pyroActive = cameraMode.pyro !== false;
        this.pyroEmitters = [new THREE.Vector3(-11, 0.3, 6), new THREE.Vector3(11, 0.3, 6)];
        if (mode === 'trophyLift') this.showTrophyLift(dt);
      } else if (mode === 'substitution') {
        const focus = cameraMode.presentationFocus ?? { x: 0, y: -HALF_WID - 3.8 };
        const fx = THREE.MathUtils.clamp(focus.x, -32, 32);
        const fz = THREE.MathUtils.clamp(focus.y, -HALF_WID - 6, HALF_WID + 6);
        presentationTarget = new THREE.Vector3(fx, 1.25, fz + 1.4);
        desired = new THREE.Vector3(
          THREE.MathUtils.clamp(fx - 9, -46, 46),
          7.4,
          THREE.MathUtils.clamp(fz + 13, -HALF_WID + 2, HALF_WID - 4),
        );
      } else {
        // interval scenes hold a goal-end beauty shot (stands + net), not the players
        presentationTarget = new THREE.Vector3(HALF_LEN - 2, 1.4, 0);
        desired = new THREE.Vector3(HALF_LEN - 30, 6.2, 15);
      }
      this.camTarget.lerp(presentationTarget, Math.min(1, dt * 5.2));
      this.camPos.lerp(desired, Math.min(1, dt * 5.4));
    } else if (cameraMode.setPiece) {
      this.setCameraFov(32);
      const restart = state.restartPos;
      const phase = state.phase;
      const sx = Math.sign(restart.x || state.attackDir[state.restartTeam] || 1);
      const sy = Math.sign(restart.y || 1);
      const atk = state.attackDir[state.restartTeam] || 1;
      let target = new THREE.Vector3(restart.x + atk * 8, 0, restart.y);
      let desired = new THREE.Vector3(restart.x - atk * 12, 7.2, restart.y + sy * 5);
      if (phase === 'throwIn') {
        target = new THREE.Vector3(
          THREE.MathUtils.clamp(restart.x + atk * 9, -HALF_LEN + 8, HALF_LEN - 8),
          0,
          restart.y - sy * 3,
        );
        desired = new THREE.Vector3(
          THREE.MathUtils.clamp(restart.x - atk * 5, -HALF_LEN - 4, HALF_LEN + 4),
          6.8,
          restart.y + sy * 13,
        );
      } else if (phase === 'corner') {
        target = new THREE.Vector3(restart.x - sx * 14, 0, restart.y - sy * 9);
        desired = new THREE.Vector3(restart.x + sx * 10, 7.8, restart.y + sy * 12);
      } else if (phase === 'goalKick') {
        target = new THREE.Vector3(restart.x - sx * 18, 0, restart.y);
        desired = new THREE.Vector3(restart.x + sx * 15, 8.4, restart.y + 5);
      } else if (phase === 'freeKick' || phase === 'penaltyKick') {
        // look along the ball-to-goal line so wide free kicks still frame the goal
        const goalX = atk * HALF_LEN;
        const gx = goalX - restart.x;
        const gy = 0 - restart.y;
        const gd = Math.hypot(gx, gy) || 1;
        target = new THREE.Vector3(restart.x + (gx / gd) * 16, 0.8, restart.y + (gy / gd) * 16);
        desired = new THREE.Vector3(
          restart.x - (gx / gd) * 14,
          7.8,
          THREE.MathUtils.clamp(restart.y - (gy / gd) * 14 + Math.sign(restart.y || 1) * 3, -HALF_WID - 14, HALF_WID + 14),
        );
      }
      this.camTarget.lerp(target, Math.min(1, dt * 6.8));
      this.camPos.lerp(desired, Math.min(1, dt * 6.6));
    } else if (cameraMode.replay) {
      // Hold the fixed behind-the-goal POSITION the replay controller chose (so
      // there are no positional jumps or side-flips like the old ball-velocity
      // camera), but pan the look-at to FOLLOW the ball so it's always framed —
      // snapping straight onto the ball on the first frame so it's in shot right
      // away, then easing after it.
      this.setCameraFov(cameraMode.fov ?? 32);
      const p = cameraMode.pos ?? { x: 0, y: 18, z: 24 };
      this.camPos.set(p.x, p.y, p.z);
      const ballTarget = new THREE.Vector3(b.pos.x, 0, b.pos.y);
      if (this.replayWasActive) {
        this.camTarget.lerp(ballTarget, Math.min(1, dt * 4.5));
      } else {
        this.camTarget.copy(ballTarget);
      }
    } else {
      // On mobile (touch) devices, zoom in closer so the ball is easier to see.
      // Player Career drops lower and tighter to frame the avatar on the ball.
      const focus = cameraMode.focusPlayerIdx != null;
      const gameFov = focus ? 30 : (this.isTouch ? 32 : 38);
      const camHeight = focus ? 22 : (this.isTouch ? 34 : 44);
      const camZOffset = focus ? 9 : (this.isTouch ? 13 : 17.5);
      const camXScale = focus ? 0.95 : (this.isTouch ? 0.88 : 0.92);
      const camZScale = focus ? 0.92 : (this.isTouch ? 0.75 : 0.82);
      this.setCameraFov(gameFov);
      this.camTarget.lerp(new THREE.Vector3(tx, 0, tz), Math.min(1, dt * 4.2));
      const desired = new THREE.Vector3(this.camTarget.x * camXScale, camHeight, this.camTarget.z * camZScale + camZOffset);
      this.camPos.lerp(desired, Math.min(1, dt * 4.0));
    }
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 1.6);
      // never jitter the locked replay vantage — keep it dead still
      if (!cameraMode.replay) {
        this.camPos.x += (Math.random() - 0.5) * this.shake;
        this.camPos.z += (Math.random() - 0.5) * this.shake;
      }
    }
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTarget.x, 0, this.camTarget.z);
    this.replayWasActive = cameraMode.replay === true;

    this.updatePrecipitation(dt);
    this.updatePyro(dt);
    this.renderer.render(this.scene, this.camera);
  }

  private setCameraFov(fov: number) {
    if (Math.abs(this.camera.fov - fov) < 0.01) return;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.disposed = true;
    window.removeEventListener('resize', this.onResize);
    this.scene.clear();
    this.renderer.dispose();
  }
}

function makeBallTexture(baseColor = '#f4f4f4'): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#16161a';
  for (let i = 0; i < 7; i++) {
    const x = (i % 3) * 48 + 18, y = Math.floor(i / 3) * 44 + 14;
    ctx.beginPath();
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 - Math.PI / 2;
      const px = x + Math.cos(a) * 11, py = y + Math.sin(a) * 11;
      k === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
