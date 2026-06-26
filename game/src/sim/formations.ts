import type { FormationId, Lineup, Vec2, Pos, TeamData, TeamTactics } from './types';

/**
 * Slot positions in attack-normalized space: x -1 = own goal line, +1 = opponent goal line,
 * y -1..1 = left..right touchline. GK is slot 0.
 */
export const FORMATIONS: Record<FormationId, Vec2[]> = {
  '2-3-5': [
    { x: -0.94, y: 0 },
    { x: -0.7, y: -0.26 }, { x: -0.7, y: 0.26 },
    { x: -0.36, y: -0.58 }, { x: -0.42, y: 0 }, { x: -0.36, y: 0.58 },
    { x: 0.24, y: -0.82 }, { x: 0.32, y: -0.42 }, { x: 0.42, y: 0 }, { x: 0.32, y: 0.42 }, { x: 0.24, y: 0.82 },
  ],
  'w-m': [
    { x: -0.94, y: 0 },
    { x: -0.68, y: -0.42 }, { x: -0.72, y: 0 }, { x: -0.68, y: 0.42 },
    { x: -0.34, y: -0.34 }, { x: -0.34, y: 0.34 },
    { x: 0.02, y: -0.28 }, { x: 0.02, y: 0.28 },
    { x: 0.36, y: -0.62 }, { x: 0.44, y: 0 }, { x: 0.36, y: 0.62 },
  ],
  '4-2-4': [
    { x: -0.94, y: 0 },
    { x: -0.62, y: -0.62 }, { x: -0.68, y: -0.22 }, { x: -0.68, y: 0.22 }, { x: -0.62, y: 0.62 },
    { x: -0.28, y: -0.24 }, { x: -0.28, y: 0.24 },
    { x: 0.28, y: -0.78 }, { x: 0.38, y: -0.28 }, { x: 0.38, y: 0.28 }, { x: 0.28, y: 0.78 },
  ],
  '4-2-2-2': [
    { x: -0.94, y: 0 },
    { x: -0.62, y: -0.62 }, { x: -0.68, y: -0.22 }, { x: -0.68, y: 0.22 }, { x: -0.62, y: 0.62 },
    { x: -0.34, y: -0.24 }, { x: -0.34, y: 0.24 },
    { x: -0.02, y: -0.44 }, { x: -0.02, y: 0.44 },
    { x: 0.36, y: -0.24 }, { x: 0.36, y: 0.24 },
  ],
  '4-3-2-1': [
    { x: -0.94, y: 0 },
    { x: -0.62, y: -0.62 }, { x: -0.68, y: -0.22 }, { x: -0.68, y: 0.22 }, { x: -0.62, y: 0.62 },
    { x: -0.32, y: -0.42 }, { x: -0.36, y: 0 }, { x: -0.32, y: 0.42 },
    { x: 0.02, y: -0.28 }, { x: 0.02, y: 0.28 },
    { x: 0.38, y: 0 },
  ],
  '4-4-2': [
    { x: -0.94, y: 0 },
    { x: -0.62, y: -0.62 }, { x: -0.68, y: -0.22 }, { x: -0.68, y: 0.22 }, { x: -0.62, y: 0.62 },
    { x: -0.18, y: -0.66 }, { x: -0.25, y: -0.22 }, { x: -0.25, y: 0.22 }, { x: -0.18, y: 0.66 },
    { x: 0.28, y: -0.25 }, { x: 0.28, y: 0.25 },
  ],
  '4-3-3': [
    { x: -0.94, y: 0 },
    { x: -0.62, y: -0.62 }, { x: -0.68, y: -0.22 }, { x: -0.68, y: 0.22 }, { x: -0.62, y: 0.62 },
    { x: -0.25, y: -0.4 }, { x: -0.3, y: 0 }, { x: -0.25, y: 0.4 },
    { x: 0.28, y: -0.6 }, { x: 0.34, y: 0 }, { x: 0.28, y: 0.6 },
  ],
  '5-3-2': [
    { x: -0.94, y: 0 },
    { x: -0.58, y: -0.7 }, { x: -0.68, y: -0.35 }, { x: -0.72, y: 0 }, { x: -0.68, y: 0.35 }, { x: -0.58, y: 0.7 },
    { x: -0.2, y: -0.4 }, { x: -0.26, y: 0 }, { x: -0.2, y: 0.4 },
    { x: 0.28, y: -0.22 }, { x: 0.28, y: 0.22 },
  ],
  '4-5-1': [
    { x: -0.94, y: 0 },
    { x: -0.62, y: -0.62 }, { x: -0.68, y: -0.22 }, { x: -0.68, y: 0.22 }, { x: -0.62, y: 0.62 },
    { x: -0.15, y: -0.7 }, { x: -0.25, y: -0.35 }, { x: -0.3, y: 0 }, { x: -0.25, y: 0.35 }, { x: -0.15, y: 0.7 },
    { x: 0.34, y: 0 },
  ],
  '3-5-2': [
    { x: -0.94, y: 0 },
    { x: -0.66, y: -0.4 }, { x: -0.72, y: 0 }, { x: -0.66, y: 0.4 },
    { x: -0.12, y: -0.75 }, { x: -0.25, y: -0.32 }, { x: -0.3, y: 0 }, { x: -0.25, y: 0.32 }, { x: -0.12, y: 0.75 },
    { x: 0.3, y: -0.22 }, { x: 0.3, y: 0.22 },
  ],
  '4-2-3-1': [
    { x: -0.94, y: 0 },
    { x: -0.62, y: -0.62 }, { x: -0.68, y: -0.22 }, { x: -0.68, y: 0.22 }, { x: -0.62, y: 0.62 },
    { x: -0.34, y: -0.24 }, { x: -0.34, y: 0.24 },
    { x: 0.02, y: -0.62 }, { x: -0.02, y: 0 }, { x: 0.02, y: 0.62 },
    { x: 0.36, y: 0 },
  ],
  '4-1-4-1': [
    { x: -0.94, y: 0 },
    { x: -0.62, y: -0.62 }, { x: -0.68, y: -0.22 }, { x: -0.68, y: 0.22 }, { x: -0.62, y: 0.62 },
    { x: -0.38, y: 0 },
    { x: -0.08, y: -0.68 }, { x: -0.16, y: -0.24 }, { x: -0.16, y: 0.24 }, { x: -0.08, y: 0.68 },
    { x: 0.36, y: 0 },
  ],
  '4-3-1-2': [
    { x: -0.94, y: 0 },
    { x: -0.62, y: -0.62 }, { x: -0.68, y: -0.22 }, { x: -0.68, y: 0.22 }, { x: -0.62, y: 0.62 },
    { x: -0.28, y: -0.44 }, { x: -0.32, y: 0 }, { x: -0.28, y: 0.44 },
    { x: 0.04, y: 0 },
    { x: 0.34, y: -0.23 }, { x: 0.34, y: 0.23 },
  ],
  '4-4-1-1': [
    { x: -0.94, y: 0 },
    { x: -0.62, y: -0.62 }, { x: -0.68, y: -0.22 }, { x: -0.68, y: 0.22 }, { x: -0.62, y: 0.62 },
    { x: -0.16, y: -0.66 }, { x: -0.25, y: -0.22 }, { x: -0.25, y: 0.22 }, { x: -0.16, y: 0.66 },
    { x: 0.1, y: 0 },
    { x: 0.4, y: 0 },
  ],
  '3-4-3': [
    { x: -0.94, y: 0 },
    { x: -0.66, y: -0.4 }, { x: -0.72, y: 0 }, { x: -0.66, y: 0.4 },
    { x: -0.16, y: -0.7 }, { x: -0.28, y: -0.24 }, { x: -0.28, y: 0.24 }, { x: -0.16, y: 0.7 },
    { x: 0.32, y: -0.58 }, { x: 0.38, y: 0 }, { x: 0.32, y: 0.58 },
  ],
  '3-4-1-2': [
    { x: -0.94, y: 0 },
    { x: -0.66, y: -0.4 }, { x: -0.72, y: 0 }, { x: -0.66, y: 0.4 },
    { x: -0.16, y: -0.7 }, { x: -0.28, y: -0.24 }, { x: -0.28, y: 0.24 }, { x: -0.16, y: 0.7 },
    { x: 0.04, y: 0 },
    { x: 0.36, y: -0.24 }, { x: 0.36, y: 0.24 },
  ],
  '3-4-2-1': [
    { x: -0.94, y: 0 },
    { x: -0.66, y: -0.4 }, { x: -0.72, y: 0 }, { x: -0.66, y: 0.4 },
    { x: -0.16, y: -0.72 }, { x: -0.28, y: -0.24 }, { x: -0.28, y: 0.24 }, { x: -0.16, y: 0.72 },
    { x: 0.12, y: -0.28 }, { x: 0.12, y: 0.28 },
    { x: 0.42, y: 0 },
  ],
  '3-1-4-2': [
    { x: -0.94, y: 0 },
    { x: -0.66, y: -0.4 }, { x: -0.72, y: 0 }, { x: -0.66, y: 0.4 },
    { x: -0.42, y: 0 },
    { x: -0.1, y: -0.72 }, { x: -0.2, y: -0.24 }, { x: -0.2, y: 0.24 }, { x: -0.1, y: 0.72 },
    { x: 0.34, y: -0.24 }, { x: 0.34, y: 0.24 },
  ],
  '5-4-1': [
    { x: -0.94, y: 0 },
    { x: -0.58, y: -0.72 }, { x: -0.68, y: -0.36 }, { x: -0.74, y: 0 }, { x: -0.68, y: 0.36 }, { x: -0.58, y: 0.72 },
    { x: -0.15, y: -0.66 }, { x: -0.26, y: -0.22 }, { x: -0.26, y: 0.22 }, { x: -0.15, y: 0.66 },
    { x: 0.34, y: 0 },
  ],
};

/** Required outfield position mix per formation (after GK), used for auto-lineups. */
export const FORMATION_NEEDS: Record<FormationId, Pos[]> = {
  '2-3-5': ['DF', 'DF', 'MF', 'MF', 'MF', 'FW', 'FW', 'FW', 'FW', 'FW'],
  'w-m': ['DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'MF', 'FW', 'FW', 'FW'],
  '4-2-4': ['DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'FW', 'FW', 'FW', 'FW'],
  '4-2-2-2': ['DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'MF', 'FW', 'FW'],
  '4-3-2-1': ['DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'MF', 'MF', 'FW'],
  '4-4-2': ['DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'MF', 'FW', 'FW'],
  '4-3-3': ['DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'FW', 'FW', 'FW'],
  '5-3-2': ['DF', 'DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'FW', 'FW'],
  '4-5-1': ['DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'MF', 'MF', 'FW'],
  '3-5-2': ['DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'MF', 'MF', 'FW', 'FW'],
  '4-2-3-1': ['DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'MF', 'MF', 'FW'],
  '4-1-4-1': ['DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'MF', 'MF', 'FW'],
  '4-3-1-2': ['DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'MF', 'FW', 'FW'],
  '4-4-1-1': ['DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'MF', 'FW', 'FW'],
  '3-4-3': ['DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'MF', 'FW', 'FW', 'FW'],
  '3-4-1-2': ['DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'MF', 'MF', 'FW', 'FW'],
  '3-4-2-1': ['DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'MF', 'MF', 'MF', 'FW'],
  '3-1-4-2': ['DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'MF', 'MF', 'FW', 'FW'],
  '5-4-1': ['DF', 'DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'MF', 'FW'],
};

export const FORMATION_IDS = Object.keys(FORMATIONS) as FormationId[];

export function overallRating(p: { pace: number; pass: number; shoot: number; tackle: number; keeping: number; pos: Pos }): number {
  if (p.pos === 'GK') return p.keeping;
  if (p.pos === 'DF') return p.tackle * 0.45 + p.pace * 0.25 + p.pass * 0.2 + p.shoot * 0.1;
  if (p.pos === 'MF') return p.pass * 0.4 + p.pace * 0.2 + p.tackle * 0.2 + p.shoot * 0.2;
  return p.shoot * 0.45 + p.pace * 0.3 + p.pass * 0.15 + p.tackle * 0.1;
}

type SlotRole = 'GK' | 'CB' | 'FB' | 'WB' | 'DM' | 'CM' | 'AM' | 'W' | 'WF' | 'ST';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function slotRole(formation: FormationId, slotIdx: number): SlotRole {
  if (slotIdx === 0) return 'GK';
  const slot = FORMATIONS[formation]?.[slotIdx] ?? { x: 0, y: 0 };
  const need = FORMATION_NEEDS[formation]?.[slotIdx - 1] ?? 'MF';
  const wide = Math.abs(slot.y);
  if (need === 'DF') {
    if (wide > 0.5) return formation.startsWith('5-') ? 'WB' : 'FB';
    return 'CB';
  }
  if (need === 'MF') {
    if (wide > 0.56) return formation.startsWith('3-') || formation.startsWith('5-') ? 'WB' : 'W';
    if (slot.x < -0.31) return 'DM';
    if (slot.x > -0.04) return 'AM';
    return 'CM';
  }
  if (wide > 0.46) return 'WF';
  return 'ST';
}

function roleFitScore(pos: Pos, role: SlotRole): number {
  if (role === 'GK') return pos === 'GK' ? 200 : -200;
  if (pos === 'GK') return -200;
  switch (role) {
    case 'CB': return pos === 'DF' ? 120 : pos === 'MF' ? 45 : 15;
    case 'FB': return pos === 'DF' ? 118 : pos === 'MF' ? 66 : 28;
    case 'WB': return pos === 'MF' ? 112 : pos === 'DF' ? 104 : 62;
    case 'DM': return pos === 'MF' ? 116 : pos === 'DF' ? 82 : 24;
    case 'CM': return pos === 'MF' ? 118 : pos === 'FW' ? 58 : 54;
    case 'AM': return pos === 'MF' ? 114 : pos === 'FW' ? 88 : 28;
    case 'W': return pos === 'MF' ? 112 : pos === 'FW' ? 98 : 42;
    case 'WF': return pos === 'FW' ? 118 : pos === 'MF' ? 86 : 24;
    case 'ST': return pos === 'FW' ? 122 : pos === 'MF' ? 46 : 18;
  }
}

export function lineupSlotFits(player: { pos: Pos }, formation: FormationId, slotIdx: number): boolean {
  return roleFitScore(player.pos, slotRole(formation, slotIdx)) >= 80;
}

/**
 * The player data only carries a coarse position (GK/DF/MF/FW), so roleFitScore can't tell a
 * centre-back from a full-back or a winger from a central midfielder. This breaks the tie on
 * ATTRIBUTES: pace for the wide/overlapping roles, tackling for the central/holding ones,
 * passing for the playmakers. It is a secondary signal — small next to roleFitScore's
 * position weighting — so a defender still fills a defensive slot, but the FAST defender
 * goes to full-back and the strong one to centre-back, the quick midfielder to the wing and
 * the passer to the middle.
 */
type SlotPlayerAttrs = { pace: number; pass: number; shoot: number; tackle: number; keeping: number };
function roleAttrBonus(p: SlotPlayerAttrs, role: SlotRole): number {
  switch (role) {
    case 'GK': return p.keeping * 0.5;
    case 'CB': return p.tackle * 0.5 - p.pace * 0.2; // strong, central, not pace-reliant
    case 'FB': return p.pace * 0.42 + p.tackle * 0.14; // fast, gets up the wing
    case 'WB': return p.pace * 0.5 + p.tackle * 0.1;
    case 'DM': return p.tackle * 0.38 + p.pass * 0.18;
    case 'CM': return p.pass * 0.44 + p.tackle * 0.1;
    case 'AM': return p.pass * 0.34 + p.shoot * 0.26;
    case 'W': return p.pace * 0.46 + p.shoot * 0.12; // wide, quick
    case 'WF': return p.pace * 0.34 + p.shoot * 0.36;
    case 'ST': return p.shoot * 0.5 + p.pace * 0.1;
  }
}

export function formationDefaultTactics(formation: FormationId): TeamTactics {
  const shape = FORMATION_NEEDS[formation] ?? FORMATION_NEEDS['4-4-2'];
  const defenders = shape.filter((p) => p === 'DF').length;
  const forwards = shape.filter((p) => p === 'FW').length;
  const profile = FORMATION_DEFAULT_TACTICS[formation];
  if (profile) return { ...profile };
  return {
    mentality: defenders >= 5 ? 'defensive' : forwards >= 3 ? 'attacking' : 'balanced',
    width: defenders >= 5 ? 48 : forwards >= 3 ? 72 : 56,
    defensiveDepth: defenders >= 5 ? 38 : forwards >= 3 ? 60 : 52,
    pressing: forwards >= 3 ? 'high' : defenders >= 5 ? 'low' : 'mid',
    buildUp: forwards >= 3 ? 'direct' : defenders >= 5 ? 'patient' : 'balanced',
  };
}

const FORMATION_DEFAULT_TACTICS: Partial<Record<FormationId, TeamTactics>> = {
  '2-3-5': { mentality: 'attacking', width: 88, defensiveDepth: 72, pressing: 'high', buildUp: 'direct' },
  'w-m': { mentality: 'balanced', width: 66, defensiveDepth: 55, pressing: 'mid', buildUp: 'balanced' },
  '4-2-4': { mentality: 'attacking', width: 84, defensiveDepth: 64, pressing: 'high', buildUp: 'direct' },
  '4-2-2-2': { mentality: 'balanced', width: 48, defensiveDepth: 54, pressing: 'mid', buildUp: 'balanced' },
  '4-3-2-1': { mentality: 'balanced', width: 42, defensiveDepth: 50, pressing: 'mid', buildUp: 'patient' },
  '4-4-2': { mentality: 'balanced', width: 58, defensiveDepth: 52, pressing: 'mid', buildUp: 'balanced' },
  '4-3-3': { mentality: 'attacking', width: 80, defensiveDepth: 62, pressing: 'high', buildUp: 'direct' },
  '5-3-2': { mentality: 'defensive', width: 60, defensiveDepth: 36, pressing: 'low', buildUp: 'balanced' },
  '4-5-1': { mentality: 'defensive', width: 62, defensiveDepth: 42, pressing: 'mid', buildUp: 'patient' },
  '3-5-2': { mentality: 'balanced', width: 74, defensiveDepth: 54, pressing: 'mid', buildUp: 'balanced' },
  '4-2-3-1': { mentality: 'balanced', width: 68, defensiveDepth: 50, pressing: 'mid', buildUp: 'balanced' },
  '4-1-4-1': { mentality: 'defensive', width: 62, defensiveDepth: 42, pressing: 'mid', buildUp: 'patient' },
  '4-3-1-2': { mentality: 'balanced', width: 42, defensiveDepth: 50, pressing: 'mid', buildUp: 'patient' },
  '4-4-1-1': { mentality: 'balanced', width: 56, defensiveDepth: 48, pressing: 'mid', buildUp: 'balanced' },
  '3-4-3': { mentality: 'attacking', width: 84, defensiveDepth: 60, pressing: 'high', buildUp: 'direct' },
  '3-4-1-2': { mentality: 'balanced', width: 64, defensiveDepth: 50, pressing: 'mid', buildUp: 'balanced' },
  '3-4-2-1': { mentality: 'balanced', width: 72, defensiveDepth: 52, pressing: 'mid', buildUp: 'balanced' },
  '3-1-4-2': { mentality: 'balanced', width: 68, defensiveDepth: 52, pressing: 'mid', buildUp: 'balanced' },
  '5-4-1': { mentality: 'defensive', width: 54, defensiveDepth: 32, pressing: 'low', buildUp: 'patient' },
};

export function normalizeTactics(tactics: Partial<TeamTactics> | undefined, formation: FormationId): TeamTactics {
  const base = formationDefaultTactics(formation);
  const mentality = tactics?.mentality === 'defensive' || tactics?.mentality === 'balanced' || tactics?.mentality === 'attacking'
    ? tactics.mentality
    : base.mentality;
  const pressing = tactics?.pressing === 'low' || tactics?.pressing === 'mid' || tactics?.pressing === 'high'
    ? tactics.pressing
    : base.pressing;
  const buildUp = tactics?.buildUp === 'patient' || tactics?.buildUp === 'balanced' || tactics?.buildUp === 'direct'
    ? tactics.buildUp
    : base.buildUp;
  return {
    mentality,
    width: Math.round(clamp(Number.isFinite(tactics?.width) ? Number(tactics?.width) : base.width, 0, 100)),
    defensiveDepth: Math.round(clamp(Number.isFinite(tactics?.defensiveDepth) ? Number(tactics?.defensiveDepth) : base.defensiveDepth, 0, 100)),
    pressing,
    buildUp,
  };
}

export function normalizeLineupForFormation(
  players: { pos: Pos; pace: number; pass: number; shoot: number; tackle: number; keeping: number }[],
  formation: FormationId,
  preferredStarters?: number[],
): number[] {
  const preferred = (preferredStarters ?? [])
    .filter((idx, pos, arr) => Number.isInteger(idx) && idx >= 0 && idx < players.length && arr.indexOf(idx) === pos)
    .slice(0, 11);
  const preferredOrder = new Map(preferred.map((idx, order) => [idx, order]));
  const used = new Set<number>();
  const lineup: number[] = [];

  const pickForSlot = (slotIdx: number): number => {
    const role = slotRole(formation, slotIdx);
    const ranked = players
      .map((p, idx) => ({
        idx,
        p,
        fit: roleFitScore(p.pos, role),
        attrFit: roleAttrBonus(p, role),
        rating: overallRating(p),
        preferred: preferredOrder.has(idx),
        order: preferredOrder.get(idx) ?? Number.MAX_SAFE_INTEGER,
      }))
      .filter((entry) => !used.has(entry.idx))
      .sort((a, b) => (
        (b.fit - a.fit)                                 // right position category first
        || (Number(b.preferred) - Number(a.preferred)) // a saved/user lineup wins
        || (b.attrFit - a.attrFit)                      // then attributes pick CB vs FB, W vs CM
        || (b.rating - a.rating)
        || (a.order - b.order)
        || (a.idx - b.idx)
      ));
    return ranked[0]?.idx ?? -1;
  };

  for (let slotIdx = 0; slotIdx < 11; slotIdx++) {
    const pick = pickForSlot(slotIdx);
    if (pick < 0) break;
    used.add(pick);
    lineup.push(pick);
  }
  return lineup.length === 11 ? lineup : [];
}

/** Pick the strongest legal XI for a formation. Returns squad indices, GK first, in slot order. */
export function autoLineup(players: { pos: Pos; pace: number; pass: number; shoot: number; tackle: number; keeping: number }[], formation: FormationId): number[] {
  return normalizeLineupForFormation(players, formation);
}

export function teamDefaultLineup(
  team: Pick<TeamData, 'players' | 'defaultLineup'>,
  fallbackFormation: FormationId = '4-4-2',
): Lineup {
  const formation = team.defaultLineup?.formation && FORMATIONS[team.defaultLineup.formation]
    ? team.defaultLineup.formation
    : fallbackFormation;
  const rawStarters = team.defaultLineup?.starters ?? [];
  const starters = normalizeLineupForFormation(team.players, formation, rawStarters);
  const fallback = starters.length === 11 ? starters : autoLineup(team.players, formation);
  return { formation, starters: fallback, tactics: normalizeTactics(team.defaultLineup?.tactics, formation) };
}
