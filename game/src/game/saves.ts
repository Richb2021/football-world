import { ensureCareerSystems, type Career } from './career';
import { TEAMS } from '../data/teams';
import { makeSaveSlots, type SaveSlots } from '../net/saveSlots';

const SETTINGS_KEY = 'sl93.settings.v1';

export interface Settings {
  difficulty: 0 | 1 | 2 | 3;
  halfLengthSec: number;
  musicVol: number;
  sfxVol: number;
}

export const DEFAULT_SETTINGS: Settings = {
  difficulty: 1,
  halfLengthSec: 150,
  musicVol: 0.7,
  sfxVol: 0.9,
};

function competitionLabel(c: Career): string {
  if (c.leagueId === 'international-cup') return 'World Cup';
  if (c.mode === 'league') return 'League Season';
  return 'Cup Run';
}

function progressLabel(c: Career): string {
  if (c.finished) return 'Finished';
  if (c.leagueId === 'international-cup' && c.step < 3) return `Group · Round ${c.step + 1}`;
  return c.cupAlive ? `In the cup · MD ${c.step + 1}` : 'Eliminated';
}

export function careerAutoName(c: Career): string {
  return `${TEAMS[c.userTeam].name} · ${competitionLabel(c)}`;
}

export const careerSlots: SaveSlots<Career> = makeSaveSlots<Career>('career', {
  cap: 6,
  summarise: (c) => ({ name: careerAutoName(c), summary: progressLabel(c) }),
  revive: (c) => ensureCareerSystems(c),
  valid: (c) => c.version === 2,
});

export function saveCareer(career: Career) {
  careerSlots.save(career);
}

export function loadCareer(): Career | null {
  return careerSlots.load();
}

export function clearCareer() {
  const id = careerSlots.active();
  if (id) careerSlots.remove(id);
}

export function saveSettings(s: Settings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* ignore quota */ }
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULT_SETTINGS };
}
