import * as THREE from 'three';
import type { KitColors, KitStyle, PlayerAppearance } from '../sim/types';
import { sampleBodyMap, type BodyMap } from './kitBodyMap';

interface TintOptions {
  appearance?: PlayerAppearance;
  style?: KitStyle;
  kitOverlayImage?: CanvasImageSource;
  kitOverlayMode?: 'pattern' | 'uv';
  /** UV->body-position lookup; when present, patterns paint in body space. */
  bodyMap?: BodyMap | null;
  /** when set (with a bodyMap), the number is baked onto the back of the shirt */
  shirtNumber?: number;
}

// body-space rectangles for printed-on shirt details, calibrated on the rigged model
const NUMBER_RECT = { latMin: 0.405, latMax: 0.595, htMin: 0.585, htMax: 0.775 };
const BADGE_RECT = { latMin: 0.422, latMax: 0.465, htMin: 0.69, htMax: 0.745 }; // wearer's left chest
/** the rigged model faces the high-dep side; the back of the shirt is low-dep */
const BACK_IS_HIGH_DEP = false;
const BACK_MIRRORED = true;

function buildNumberMask(num: number): { data: Uint8ClampedArray; size: number } {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${num >= 10 ? 86 : 102}px Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(num), size / 2, size / 2 + 4);
  return { data: ctx.getImageData(0, 0, size, size).data, size };
}

/**
 * Recolour the Meshy player texture per team. The base model wears a white shirt,
 * mid-grey shorts and white socks; we map low-saturation light pixels to the shirt
 * colour and low-saturation mid pixels to the shorts colour. Skin/boots/hair stay.
 */
export function tintKitTexture(source: THREE.Texture, kit: KitColors, options: TintOptions = {}): THREE.Texture {
  const img = source.image as HTMLImageElement | ImageBitmap | undefined;
  if (!img || !(img as any).width) return source;
  // bake at most 512^2: 22 per-player textures at full source size cost ~90MB
  // of VRAM and visibly stutter on integrated GPUs; at the match camera the
  // difference is imperceptible
  const MAX_BAKE = 512;
  const scale = Math.min(1, MAX_BAKE / Math.max((img as any).width, (img as any).height));
  const w = Math.round((img as any).width * scale), h = Math.round((img as any).height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img as any, 0, 0, w, h);
  const baseData = ctx.getImageData(0, 0, w, h);
  if (options.kitOverlayImage && options.kitOverlayMode === 'uv') {
    ctx.drawImage(options.kitOverlayImage, 0, 0, w, h);
  }
  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;
  const basePx = baseData.data;
  const shirt = hex(kit.shirt);
  const shorts = hex(kit.shorts);
  const skin = options.appearance ? hex(options.appearance.skinTone) : null;
  const hair = options.appearance?.hairColor ? hex(options.appearance.hairColor) : null;
  const facialHair = options.appearance?.facialHair ?? 'none';
  const bald = options.appearance?.hairStyle === 'bald';
  const style = options.style;
  const secondary = style?.secondary ? hex(style.secondary) : shorts;
  const overlay = options.kitOverlayImage && options.kitOverlayMode !== 'uv'
    ? readOverlayPixels(options.kitOverlayImage, w, h)
    : null;
  const uvMode = Boolean(options.kitOverlayImage && options.kitOverlayMode === 'uv');
  // printed-on shirt details (need the body map to know back from front)
  const numberMask = options.bodyMap && options.shirtNumber ? buildNumberMask(options.shirtNumber) : null;
  const numberColor = hex(style?.numberColor ?? readableTextColor(kit.shirt));
  const badgeColor = style?.trim ? hex(style.trim) : hex(kit.socks);

  for (let i = 0; i < px.length; i += 4) {
    const r = basePx[i], g = basePx[i + 1], b = basePx[i + 2];
    const pixel = i / 4;
    const x = pixel % w;
    const y = Math.floor(pixel / w);
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const light = max / 255;
    const sat = max === 0 ? 0 : (max - min) / max;
    const region = baseKitRegionForPixel(r, g, b);
    if (region === 'shirt') {
      const body = options.bodyMap ? sampleBodyMap(options.bodyMap, x / w, y / h) : null;
      // white pixels low on the body are the socks, not the shirt
      if (body && body.ht < 0.28) {
        const socks = hex(kit.socks);
        px[i] = (r * socks[0]) >> 8;
        px[i + 1] = (g * socks[1]) >> 8;
        px[i + 2] = (b * socks[2]) >> 8;
        if (overlay) multiplyOverlay(px, overlay, i);
        continue;
      }
      // A bright/low-sat pixel the COLOUR classifier read as shirt, but that the body map
      // places below the shirt hem, is really a highlight on the SHORTS — paint it the
      // shorts colour. Without this, a kit with dark shorts (e.g. England's navy) is
      // speckled white wherever the base shorts texture is bright (the "blotchy" look).
      // Socks (<0.28) are handled above and bare-leg skin is the null region (never here),
      // so anything left below ~0.50 is shorts. (0.50 ≈ the shirt hem in body height.)
      if (body && body.ht < 0.50) {
        if (uvMode) {
          pullPixelTowards(px, i, shorts, 0.84);
        } else {
          const shade = clampNum(light * 1.55, 0.42, 1.08);
          px[i] = Math.min(255, shorts[0] * shade);
          px[i + 1] = Math.min(255, shorts[1] * shade);
          px[i + 2] = Math.min(255, shorts[2] * shade);
        }
        if (overlay) multiplyOverlay(px, overlay, i);
        continue;
      }
      // shirt areas -> patterned shirt colour (keeps shading via multiply)
      let c = body
        ? shirtPatternColorBody(style, shirt, secondary, body.lat, body.ht)
        : shirtPatternColor(style, shirt, secondary, x / w, y / h);
      if (body) {
        const onBack = BACK_IS_HIGH_DEP ? body.dep > 0.5 : body.dep <= 0.5;
        if (numberMask && onBack
          && body.lat >= NUMBER_RECT.latMin && body.lat <= NUMBER_RECT.latMax
          && body.ht >= NUMBER_RECT.htMin && body.ht <= NUMBER_RECT.htMax) {
          let u = (body.lat - NUMBER_RECT.latMin) / (NUMBER_RECT.latMax - NUMBER_RECT.latMin);
          if (BACK_MIRRORED) u = 1 - u;
          const v = (NUMBER_RECT.htMax - body.ht) / (NUMBER_RECT.htMax - NUMBER_RECT.htMin);
          const mx = Math.min(numberMask.size - 1, Math.max(0, Math.floor(u * numberMask.size)));
          const my = Math.min(numberMask.size - 1, Math.max(0, Math.floor(v * numberMask.size)));
          if (numberMask.data[(my * numberMask.size + mx) * 4 + 3] > 120) c = numberColor;
        } else if (!onBack
          && body.lat >= BADGE_RECT.latMin && body.lat <= BADGE_RECT.latMax
          && body.ht >= BADGE_RECT.htMin && body.ht <= BADGE_RECT.htMax) {
          c = badgeColor; // small printed crest chip on the chest
        }
      }
      if (uvMode) {
        pullPixelTowards(px, i, c, 0.18);
      } else {
        px[i] = (r * c[0]) >> 8;
        px[i + 1] = (g * c[1]) >> 8;
        px[i + 2] = (b * c[2]) >> 8;
      }
      if (overlay) multiplyOverlay(px, overlay, i);
    } else if (region === 'shorts') {
      // grey/brown shorts -> shorts colour, brightened so dark kits still read
      if (uvMode) {
        pullPixelTowards(px, i, shorts, 0.84);
      } else {
        const shade = clampNum(light * 1.55, 0.42, 1.08);
        px[i] = Math.min(255, shorts[0] * shade);
        px[i + 1] = Math.min(255, shorts[1] * shade);
        px[i + 2] = Math.min(255, shorts[2] * shade);
      }
      if (overlay) multiplyOverlay(px, overlay, i);
    } else if (skin && isSkinPixel(r, g, b, sat, light)) {
      const shade = clampNum(light * 1.15, 0.35, 1.15);
      let base = skin;
      // facial hair is painted into the face, part of the player like real skin;
      // weights feather to zero at the zone edges so nothing reads as a box
      if (hair && options.bodyMap && facialHair !== 'none') {
        const body = sampleBodyMap(options.bodyMap, x / w, y / h);
        // the mouth line sits at ht ~0.890 on this rig (probed from the texture)
        // and the nose base just above 0.906 — facial hair stays clear of both
        if (body && body.dep > 0.52 && body.ht > 0.82 && body.ht < 0.906) {
          const dl = Math.abs(body.lat - 0.5);
          const beardShape = feather(0.825, 0.880, body.ht, 0.014) * feather(-0.048, 0.048, body.lat - 0.5, 0.018);
          const tacheShape = feather(0.896, 0.9055, body.ht, 0.004) * feather(-0.019, 0.019, body.lat - 0.5, 0.008);
          let amount = 0;
          if (facialHair === 'beard') amount = Math.max(beardShape * 0.5, tacheShape * 0.45);
          else if (facialHair === 'moustache') amount = tacheShape * 0.55;
          else if (facialHair === 'stubble') amount = Math.max(beardShape, tacheShape) * 0.24;
          // never paint over the mouth band or any drawn feature line
          if (body.ht > 0.882 && body.ht < 0.896) amount = 0;
          if (light < 0.5) amount = 0;
          if (amount > 0.01 && dl < 0.06) {
            base = [
              skin[0] * (1 - amount) + hair[0] * amount,
              skin[1] * (1 - amount) + hair[1] * amount,
              skin[2] * (1 - amount) + hair[2] * amount,
            ];
          }
        }
      }
      px[i] = Math.min(255, base[0] * shade);
      px[i + 1] = Math.min(255, base[1] * shade);
      px[i + 2] = Math.min(255, base[2] * shade);
    } else if (hair && options.bodyMap && light < 0.45) {
      // dark pixels high on the head are the hair: blend towards the player's
      // hair colour while keeping the original shading, so fringe shadows on
      // the forehead soften instead of becoming a hard painted band
      const body = sampleBodyMap(options.bodyMap, x / w, y / h);
      if (body && body.ht > 0.875) {
        const target = bald && skin ? skin : hair;
        const lift = bald ? clampNum(0.6 + light * 0.7, 0.55, 1.05) : clampNum(0.35 + light * 1.3, 0.35, 1.15);
        const blend = bald ? 0.92 : 0.72;
        px[i] = Math.min(255, r * (1 - blend) + target[0] * lift * blend);
        px[i + 1] = Math.min(255, g * (1 - blend) + target[1] * lift * blend);
        px[i + 2] = Math.min(255, b * (1 - blend) + target[2] * lift * blend);
      }
    } else if (uvMode) {
      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
    }
  }
  ctx.putImageData(data, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = source.flipY;
  tex.wrapS = source.wrapS;
  tex.wrapT = source.wrapT;
  return tex;
}

export function shouldMaskGeneratedKitOverlay(r: number, g: number, b: number): boolean {
  return baseKitRegionForPixel(r, g, b) !== null;
}

export function baseKitRegionForPixel(r: number, g: number, b: number): 'shirt' | 'shorts' | null {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const light = max / 255;
  const sat = max === 0 ? 0 : (max - min) / max;
  if (sat < 0.18 && light > 0.62) return 'shirt';
  if (sat < 0.22 && light > 0.3 && light <= 0.62) return 'shorts';
  if (
    r > 105 && r < 180
    && g > 70 && g < 135
    && b < 95
    && b < r * 0.4
    && r - g > 22
    && g - b > 18
  ) return 'shorts';
  return null;
}

/**
 * Pattern colour decided by where the texel sits on the BODY (bind pose),
 * so stripes run down the chest and hoops wrap the torso like a real kit.
 * lat: 0..1 across the T-pose arm span; ht: 0..1 feet-to-head.
 */
export function shirtPatternColorBody(
  style: KitStyle | undefined,
  primary: [number, number, number],
  secondary: [number, number, number],
  lat: number,
  ht: number,
): [number, number, number] {
  if (!style || style.pattern === 'solid') return primary;
  if (style.pattern === 'stripes') return Math.floor(lat * 24) % 2 === 0 ? primary : secondary;
  if (style.pattern === 'hoops') return Math.floor(ht * 18) % 2 === 0 ? primary : secondary;
  if (style.pattern === 'halves') return lat < 0.5 ? primary : secondary;
  if (style.pattern === 'sash') {
    // diagonal band from right shoulder to left hip
    const d = (lat - 0.5) + (ht - 0.62) * 0.55;
    return Math.abs(d) < 0.055 ? secondary : primary;
  }
  if (style.pattern === 'sleeves') return Math.abs(lat - 0.5) > 0.105 ? secondary : primary;
  return primary;
}

function shirtPatternColor(style: KitStyle | undefined, primary: [number, number, number], secondary: [number, number, number], u: number, v: number): [number, number, number] {
  if (!style || style.pattern === 'solid') return primary;
  if (style.pattern === 'stripes') return Math.floor(u * 8) % 2 === 0 ? primary : secondary;
  if (style.pattern === 'hoops') return Math.floor(v * 8) % 2 === 0 ? primary : secondary;
  if (style.pattern === 'halves') return u < 0.5 ? primary : secondary;
  if (style.pattern === 'sash') return Math.abs((u - v) - 0.05) < 0.16 ? secondary : primary;
  if (style.pattern === 'sleeves') return u < 0.22 || u > 0.78 ? secondary : primary;
  return primary;
}

function readOverlayPixels(image: CanvasImageSource, w: number, h: number): Uint8ClampedArray {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h).data;
}

function multiplyOverlay(px: Uint8ClampedArray, overlay: Uint8ClampedArray, i: number): void {
  // Generated images are pattern/detail sources, not UV sheets. Keep the base
  // model UV and blend only a restrained amount of source detail into kit pixels.
  const amount = 0.18;
  px[i] = Math.round(px[i] * (1 - amount + amount * (overlay[i] / 255)));
  px[i + 1] = Math.round(px[i + 1] * (1 - amount + amount * (overlay[i + 1] / 255)));
  px[i + 2] = Math.round(px[i + 2] * (1 - amount + amount * (overlay[i + 2] / 255)));
}

function pullPixelTowards(px: Uint8ClampedArray, i: number, target: [number, number, number], amount: number): void {
  px[i] = Math.round(px[i] * (1 - amount) + target[0] * amount);
  px[i + 1] = Math.round(px[i + 1] * (1 - amount) + target[1] * amount);
  px[i + 2] = Math.round(px[i + 2] * (1 - amount) + target[2] * amount);
}

function isSkinPixel(r: number, g: number, b: number, sat: number, light: number): boolean {
  return light > 0.28 && light < 0.92 && sat > 0.12 && r > b * 1.08 && g > b * 0.78 && r > 85;
}

/** 1 inside [lo, hi], easing to 0 across `soft` at each boundary */
function feather(lo: number, hi: number, v: number, soft: number): number {
  return clampNum(Math.min(v - lo, hi - v) / soft, 0, 1);
}

function clampNum(v: number, a: number, b: number): number {
  return Math.min(b, Math.max(a, v));
}

function hex(c: string): [number, number, number] {
  const v = c.replace('#', '');
  const n = parseInt(v.length === 3 ? v.split('').map((x) => x + x).join('') : v, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function readableTextColor(bg: string): string {
  const [r, g, b] = hex(bg);
  const luminance = 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
  return luminance > 0.48 ? '#111111' : '#ffffff';
}

function srgb(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(c: string): number {
  const [r, g, b] = hex(c);
  return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
}

/** HSL hue (0..360), saturation (0..1) for a hex colour. */
function hueSat(c: string): { h: number; s: number; l: number } {
  const [r, g, b] = hex(c).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d < 1e-6) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h * 60, s, l };
}

function hueDelta(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Whether two shirts read as the same colour from the overhead match camera.
 * Up close, raw RGB distance is enough; from above the chroma washes out, so
 * shirts of similar brightness blur together unless their hue is strongly
 * different — and any two near-black or two washed-out greys always merge.
 */
function shirtsClash(x: string, y: string): boolean {
  const a = hex(x), b = hex(y);
  const rgb = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
  if (rgb < 200) return true;                       // plainly close in RGB
  const ca = hueSat(x), cb = hueSat(y);
  const dL = Math.abs(luminance(x) - luminance(y));
  const dH = hueDelta(ca.h, cb.h);
  if (dL < 0.22 && dH < 95) return true;            // similar brightness + hue family
  if (luminance(x) < 0.12 && luminance(y) < 0.12) return true; // both read as black
  if (ca.s < 0.22 && cb.s < 0.22 && dL < 0.34) return true;    // two muted greys
  return false;
}

function visibleShirtColours(kit: KitColors): string[] {
  const rawStyle = kit.style as Partial<KitStyle> | KitStyle['pattern'] | undefined;
  const pattern = typeof rawStyle === 'string' ? rawStyle : rawStyle?.pattern;
  const secondary = typeof rawStyle === 'string' ? undefined : rawStyle?.secondary;
  const colours = [kit.shirt];
  if (pattern && pattern !== 'solid') {
    colours.push(secondary ?? kit.shorts);
  }
  return [...new Set(colours.filter(Boolean).map((c) => c.toLowerCase()))];
}

function kitsClash(a: KitColors, b: KitColors): boolean {
  return visibleShirtColours(a).some((ca) => visibleShirtColours(b).some((cb) => shirtsClash(ca, cb)));
}

/** A clearly distinct emergency colour, used when neither stored away kit works. */
function contrastFallback(used: string[]): KitColors {
  const options = ['#ffd400', '#1565ff', '#e0263c', '#00b070', '#ff6bd6', '#16e0c8', '#ff8800', '#ffffff', '#101418'];
  let best = options[0];
  let bestScore = -1;
  for (const opt of options) {
    const score = Math.min(...used.map((u) => (shirtsClash(opt, u) ? 0 : 1 + Math.abs(luminance(opt) - luminance(u)))));
    if (score > bestScore) { bestScore = score; best = opt; }
  }
  const shorts = luminance(best) > 0.5 ? '#1a1a1a' : '#f2f2f2';
  return { shirt: best, shorts, socks: best };
}

/** Pick a GK kit clashing with neither team, judged from the overhead camera. */
export function goalkeeperKit(a: KitColors, b: KitColors): KitColors {
  const options = ['#ffd400', '#00c2a8', '#ff6bd6', '#92e000', '#ff8800'];
  for (const opt of options) {
    if (!shirtsClash(opt, a.shirt) && !shirtsClash(opt, b.shirt)) {
      return { shirt: opt, shorts: '#1a1a1a', socks: opt };
    }
  }
  return contrastFallback([a.shirt, b.shirt]);
}

/** Resolve an away-kit clash like the old games did: away team switches if the
 * shirts would look alike on the pitch — using the overhead perceptual test. */
export function pickKits(home: { home: KitColors; away: KitColors }, away: { home: KitColors; away: KitColors }): [KitColors, KitColors] {
  const h = home.home;
  if (!kitsClash(h, away.home)) return [h, away.home];
  if (!kitsClash(h, away.away)) return [h, away.away];
  // both stored kits still merge with the home shirt from above — go emergency
  return [h, contrastFallback(visibleShirtColours(h))];
}

/**
 * Pick a kit for a team that does NOT clash with an opponent whose kit is already fixed
 * (e.g. the user's club in Stars/World-Tour). Tries the team's home, then away, then an
 * emergency contrast colour — the overhead clash test all the way through, so two near-white
 * sides never take the field together.
 */
export function pickNonClashingKit(opponentKit: KitColors, colors: { home: KitColors; away: KitColors }): KitColors {
  if (!kitsClash(opponentKit, colors.home)) return colors.home;
  if (!kitsClash(opponentKit, colors.away)) return colors.away;
  return contrastFallback(visibleShirtColours(opponentKit));
}
