import type {
  BadgeShape,
  FacialHair,
  HairStyle,
  KitColors,
  KitPattern,
  KitStyle,
  PlayerAppearance,
  PlayerAttrs,
} from '../sim/types';

export type KitSide = 'home' | 'away' | 'gk';

const SKIN_TONES = ['#f1c9a5', '#d9a06b', '#b9794f', '#8a5538', '#5c3424', '#3c2419'];
const HAIR_COLORS = ['#171412', '#3a2418', '#6a4426', '#b88645', '#d7c08a', '#5a5a5a'];
const BOOT_COLORS = ['#151515', '#f4f4f4', '#c60019', '#1848c8', '#f0d000', '#27a060'];
const HAIR_STYLES: HairStyle[] = ['short', 'crop', 'curly', 'bald', 'long'];
const FACIAL_HAIR: FacialHair[] = ['none', 'none', 'none', 'stubble', 'moustache', 'beard'];
const PATTERNS: KitPattern[] = ['solid', 'stripes', 'hoops', 'halves', 'sash', 'sleeves'];
const BADGES: BadgeShape[] = ['shield', 'round', 'crest'];

export function defaultAppearanceForPlayer(player: PlayerAttrs, teamId: string, squadIdx: number): PlayerAppearance {
  const h = hashString(`${teamId}|${squadIdx}|${player.name}`);
  const skinTone = pick(SKIN_TONES, h);
  const hairStyle = pick(HAIR_STYLES, h >>> 3);
  return {
    skinTone,
    hairColor: hairStyle === 'bald' ? pick(HAIR_COLORS, h >>> 8) : pick(HAIR_COLORS, h >>> 5),
    hairStyle,
    facialHair: pick(FACIAL_HAIR, h >>> 11),
    bootColor: pick(BOOT_COLORS, h >>> 15),
  };
}

export function resolveAppearance(player: PlayerAttrs, teamId: string, squadIdx: number): PlayerAppearance {
  const base = defaultAppearanceForPlayer(player, teamId, squadIdx);
  const explicit = player.appearance ?? {};
  return {
    ...base,
    ...explicit,
    skinTone: normalizeHex(explicit.skinTone ?? base.skinTone),
    hairColor: normalizeHex(explicit.hairColor ?? base.hairColor),
    bootColor: normalizeHex(explicit.bootColor ?? base.bootColor ?? '#151515'),
  };
}

export function defaultKitStyleForTeam(teamId: string, side: KitSide, kit: KitColors, teamShort: string): KitStyle {
  const h = hashString(`${teamId}|${side}|${kit.shirt}|${kit.shorts}|${kit.socks}`);
  const pattern = side === 'gk' ? 'solid' : pick(PATTERNS, h);
  const secondary = side === 'gk' ? '#1a1a1a' : kit.shorts;
  return {
    pattern,
    secondary,
    trim: kit.socks,
    numberColor: readableTextColor(kit.shirt),
    badgeShape: pick(BADGES, h >>> 7),
    badgeText: teamShort.slice(0, 3).toUpperCase(),
  };
}

export function resolveKitStyle(kit: KitColors, teamId: string, side: KitSide, teamShort: string): KitStyle {
  const base = defaultKitStyleForTeam(teamId, side, kit, teamShort);
  const style = kit.style ?? {};
  return {
    ...base,
    ...style,
    secondary: normalizeHex(style.secondary ?? base.secondary ?? kit.shorts),
    trim: normalizeHex(style.trim ?? base.trim ?? kit.socks),
    numberColor: normalizeHex(style.numberColor ?? base.numberColor ?? '#ffffff'),
    badgeText: (style.badgeText ?? base.badgeText ?? teamShort).slice(0, 4).toUpperCase(),
  };
}

export function shirtNumberForPlayer(player: { squadIdx: number; attrs?: Pick<PlayerAttrs, 'shirtNumber'> }): number {
  return clampInt(player.attrs?.shirtNumber ?? player.squadIdx + 1, 1, 99);
}

export function buildKitVisualKey(
  kit: KitColors,
  style: KitStyle,
  shirtNumber: number,
  teamId: string,
  side: KitSide,
): string {
  return [
    teamId,
    side,
    kit.shirt,
    kit.shorts,
    kit.socks,
    style.pattern,
    style.secondary,
    style.trim,
    style.numberColor,
    style.badgeShape,
    style.badgeText,
    style.badgeAssetKey,
    style.kitAssetKey,
    shirtNumber,
  ].join('|');
}

export function visualManifestKey(kind: 'badge' | 'kit', teamId: string, side?: KitSide): string {
  return side ? `${kind}_${teamId}_${side}` : `${kind}_${teamId}`;
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function normalizeHex(color: string): string {
  const raw = color.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw;
  if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
    return `#${raw.slice(1).split('').map((c) => c + c).join('')}`;
  }
  return '#ffffff';
}

function readableTextColor(bg: string): string {
  const [r, g, b] = hexToRgb(bg);
  const luminance = (0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b));
  return luminance > 0.48 ? '#111111' : '#ffffff';
}

function hexToRgb(color: string): [number, number, number] {
  const normalized = normalizeHex(color).replace('#', '');
  const n = parseInt(normalized, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function srgb(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function pick<T>(arr: T[], h: number): T {
  return arr[h % arr.length];
}

function clampInt(v: number, a: number, b: number): number {
  return Math.min(b, Math.max(a, Math.round(v)));
}
