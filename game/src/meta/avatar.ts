/**
 * Procedural 2D character art, generated as seeded SVG (pure strings — no
 * canvas, works in tests and the browser). Lets us populate the cup and story
 * with many distinct fictional faces without shipping image assets. A real PNG
 * can always be supplied instead via `avatarAsset`.
 */
import type { SenderType } from './metaTypes';

function hash(seed: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** deterministic pseudo-random stream from a seed */
function rng(seed: string) {
  let s = hash(seed) || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

const SKIN = ['#f1c9a5', '#e0ac85', '#c68642', '#a9663a', '#8d5524', '#5c3a1e', '#f7d7b8'];
const HAIR = ['#2b2b2b', '#1a1a1a', '#3d2b1f', '#5a3a22', '#7a4a26', '#b07a3a', '#d9c27a', '#9a9a9a', '#e8e8e8'];
const SHIRT = ['#1d4e89', '#b3243b', '#1f7a3d', '#e0a106', '#5a2d82', '#0d6b6b', '#c44a17', '#2a2a35', '#d8dde6'];

export interface AvatarPalette {
  skin: string;
  hair: string;
  shirt: string;
  /** 0..3 hairstyle, 0..2 facial hair, 0..1 brow */
  style: number;
  beard: number;
  bald: boolean;
}

export function avatarPalette(seed: string, shirtHint?: string): AvatarPalette {
  const r = rng(seed);
  const bald = r() < 0.16;
  return {
    skin: SKIN[Math.floor(r() * SKIN.length)],
    hair: HAIR[Math.floor(r() * HAIR.length)],
    shirt: shirtHint ?? SHIRT[Math.floor(r() * SHIRT.length)],
    style: Math.floor(r() * 4),
    beard: Math.floor(r() * 3),
    bald,
  };
}

function hairPath(style: number): string {
  switch (style) {
    case 0: return '<path d="M18 40 Q50 6 82 40 L82 34 Q50 0 18 34 Z" fill="HAIR"/>';
    case 1: return '<path d="M16 44 Q50 4 84 44 Q84 24 50 18 Q16 24 16 44 Z" fill="HAIR"/><path d="M16 44 Q12 60 20 64 L24 44 Z" fill="HAIR"/><path d="M84 44 Q88 60 80 64 L76 44 Z" fill="HAIR"/>';
    case 2: return '<path d="M20 38 Q50 10 80 38 Q70 20 50 18 Q30 20 20 38 Z" fill="HAIR"/>';
    default: return '<path d="M14 46 Q50 2 86 46 Q86 30 70 22 Q60 36 50 30 Q40 36 30 22 Q14 30 14 46 Z" fill="HAIR"/>';
  }
}

function beardPath(beard: number): string {
  if (beard === 0) return '';
  if (beard === 1) return '<path d="M30 58 Q50 78 70 58 Q70 70 50 76 Q30 70 30 58 Z" fill="HAIR" opacity="0.92"/>';
  return '<path d="M34 64 Q50 72 66 64 Q60 72 50 73 Q40 72 34 64 Z" fill="HAIR" opacity="0.9"/>';
}

/** A head-and-shoulders portrait SVG (100x100 viewBox). */
export function portraitSvg(seed: string, shirtHint?: string): string {
  const p = avatarPalette(seed, shirtHint);
  const hair = p.bald ? '' : hairPath(p.style).replace(/HAIR/g, p.hair);
  const beard = p.bald ? beardPath(p.beard).replace(/HAIR/g, p.hair) : beardPath(p.beard).replace(/HAIR/g, p.hair);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">`
    + `<rect width="100" height="100" rx="14" fill="#16202e"/>`
    + `<circle cx="50" cy="92" r="40" fill="${p.shirt}"/>`
    + `<rect x="42" y="56" width="16" height="18" rx="6" fill="${p.skin}"/>`
    + `<circle cx="50" cy="44" r="26" fill="${p.skin}"/>`
    + hair
    + `<circle cx="40" cy="44" r="3" fill="#22303f"/><circle cx="60" cy="44" r="3" fill="#22303f"/>`
    + `<path d="M44 56 Q50 60 56 56" stroke="#9a5a44" stroke-width="2" fill="none" stroke-linecap="round"/>`
    + beard
    + `</svg>`;
}

/** A full standing figure SVG (140x230 viewBox) — for a press-room speaker.
 * Reuses the portrait drawing for the head (a nested 100x100 svg) so the face
 * stays consistent, then adds a torso/arms beneath it. */
export function figureSvg(seed: string, shirtHint?: string): string {
  const p = avatarPalette(seed, shirtHint);
  const head = portraitSvg(seed, shirtHint)
    .replace('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">', '<svg x="35" y="2" width="70" height="70" viewBox="0 0 100 100">')
    // drop the portrait's rounded background + shoulders; keep just the head art
    .replace('<rect width="100" height="100" rx="14" fill="#16202e"/>', '')
    .replace(`<circle cx="50" cy="92" r="40" fill="${p.shirt}"/>`, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 230">`
    + `<rect x="30" y="120" width="80" height="110" rx="22" fill="${p.shirt}"/>`
    + `<rect x="14" y="124" width="26" height="84" rx="13" fill="${p.shirt}"/>`
    + `<rect x="100" y="124" width="26" height="84" rx="13" fill="${p.shirt}"/>`
    + `<rect x="58" y="104" width="24" height="26" rx="9" fill="${p.skin}"/>`
    + head
    + `</svg>`;
}

export function avatarDataUrl(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Convenience: a portrait data URL from a seed. */
export function portraitUrl(seed: string, shirtHint?: string): string {
  return avatarDataUrl(portraitSvg(seed, shirtHint));
}

/** Convenience: a full-figure data URL from a seed. */
export function figureUrl(seed: string, shirtHint?: string): string {
  return avatarDataUrl(figureSvg(seed, shirtHint));
}

/** Pick a stable shirt-ish tint for a sender type so contacts read consistently. */
export function senderTint(type: SenderType): string | undefined {
  switch (type) {
    case 'chairman': return '#3a2d5a';
    case 'agent': return '#0d6b6b';
    case 'media': case 'pundit': return '#b3243b';
    case 'family': return '#c44a17';
    case 'physio': return '#1f7a3d';
    case 'captain': case 'teammate': return '#1d4e89';
    default: return undefined;
  }
}
