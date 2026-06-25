import catalogJson from '../data/commentaryCatalog.json';
import type { GameAssets } from './assets';
import type { MatchConfig, MatchState, SimEvent, SimPlayer } from '../sim/types';

export type CommentarySpeaker = 'commentator' | 'pundit';
export type CommentaryIntensity = 'calm' | 'excited' | 'big';

export interface CommentaryPhrase {
  id: string;
  speaker: CommentarySpeaker;
  category: string;
  intensity: CommentaryIntensity;
  text: string;
  previousText?: string;
  nextText?: string;
  /** goal phrases only: match situation this call was written for */
  context?: 'equalizer' | 'lead' | 'extend' | 'late' | 'early' | 'consolation';
}

/**
 * When set (by the engine, from the generated clip manifest), phrase pickers
 * only choose lines that actually have voice audio — so freshly authored
 * catalog entries stay dormant until their clips are generated.
 */
let availableClipIds: Set<string> | null = null;
const resolvedPlayerClipCache = new Map<string, string>();

export function setAvailableClipIds(ids: Set<string> | null) {
  availableClipIds = ids;
  resolvedPlayerClipCache.clear();
}

export interface CommentaryCatalog {
  version: number;
  people: Record<CommentarySpeaker, string>;
  voices: Record<CommentarySpeaker, string>;
  nameStyles: {
    intensity: CommentaryIntensity;
    previousText: string;
    nextText: string;
  }[];
  phrases: CommentaryPhrase[];
}

export interface CommentaryManifestClip {
  id: string;
  src: string;
  speaker: CommentarySpeaker;
  kind: 'phrase' | 'team' | 'stadium' | 'player' | 'playerFull' | 'number';
  intensity?: CommentaryIntensity;
  text?: string;
}

export interface CommentaryManifest {
  version: number;
  generatedAt: string;
  people: Record<CommentarySpeaker, string>;
  voices: Record<CommentarySpeaker, string>;
  clips: Record<string, CommentaryManifestClip>;
}

export interface CommentaryLine {
  ids: string[];
  speaker: CommentarySpeaker;
  priority: number;
  cooldownKey: string;
}

export interface CommentaryClipTiming {
  durationMs: number;
  leadingSilenceMs: number;
  trailingSilenceMs: number;
}

export interface CommentaryStitchSegment {
  id: string;
  startMs: number;
  offsetMs: number;
  durationMs: number;
  fadeInMs: number;
  fadeOutMs: number;
}

export const COMMENTARY_CATALOG = catalogJson as CommentaryCatalog;

const SLUG_REPLACEMENTS: Record<string, string> = {
  '&': 'and',
};

export function slugifyName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[&]/g, (m) => SLUG_REPLACEMENTS[m] ?? m)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function playerCallName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? name.trim();
  const surnameParticles = new Set(['da', 'de', 'del', 'den', 'der', 'la', 'le', 'van', 'von']);
  let start = parts.length - 1;
  while (start > 0 && surnameParticles.has(parts[start - 1].toLowerCase())) start--;
  return parts.slice(start).join(' ');
}

export function teamNameClipId(teamId: string, intensity: CommentaryIntensity): string {
  return `team.${spokenTeamId(teamId)}.${intensity}`;
}

export function stadiumNameClipId(teamId: string): string {
  return `stadium.${spokenTeamId(teamId)}.calm`;
}

export function scoreNumberClipId(score: number, intensity: CommentaryIntensity): string {
  return `number.${clampScoreNumber(score)}.${intensity}`;
}

export function playerNameClipId(teamId: string, playerName: string, intensity: CommentaryIntensity): string {
  return buildPlayerClipId('player', spokenTeamId(teamId), playerName, intensity);
}

export function playerFullNameClipId(teamId: string, playerName: string, intensity: CommentaryIntensity): string {
  return buildPlayerClipId('player-full', spokenTeamId(teamId), playerName, intensity);
}

function spokenTeamId(teamId: string): string {
  return slugifyName(teamId).replace(/-(95|96|97)$/u, '');
}

function buildPlayerClipId(
  kind: 'player' | 'player-full',
  teamSlug: string,
  playerName: string,
  intensity: CommentaryIntensity,
): string {
  return `${kind}.${teamSlug}.${slugifyName(playerName)}.${intensity}`;
}

function availablePlayerNameClipId(teamId: string, playerName: string, intensity: CommentaryIntensity): string {
  return availablePlayerClipId('player', teamId, playerName, intensity);
}

function availablePlayerFullNameClipId(teamId: string, playerName: string, intensity: CommentaryIntensity): string {
  return availablePlayerClipId('player-full', teamId, playerName, intensity);
}

function availablePlayerClipId(
  kind: 'player' | 'player-full',
  teamId: string,
  playerName: string,
  intensity: CommentaryIntensity,
): string {
  const preferred = kind === 'player'
    ? playerNameClipId(teamId, playerName, intensity)
    : playerFullNameClipId(teamId, playerName, intensity);
  if (!availableClipIds) return preferred;

  const cacheKey = `${kind}|${teamId}|${playerName}|${intensity}`;
  const cached = resolvedPlayerClipCache.get(cacheKey);
  if (cached) return cached;

  const exactSeason = buildPlayerClipId(kind, slugifyName(teamId), playerName, intensity);
  let resolved = [preferred, exactSeason].find((id) => availableClipIds?.has(id));
  if (!resolved) {
    const prefix = `${kind}.${spokenTeamId(teamId)}-`;
    const suffix = `.${slugifyName(playerName)}.${intensity}`;
    resolved = [...availableClipIds]
      .filter((id) => id.startsWith(prefix) && id.endsWith(suffix))
      .sort()[0];
  }

  const id = resolved ?? preferred;
  resolvedPlayerClipCache.set(cacheKey, id);
  return id;
}

export function pickSettingPhrase(cfg: MatchConfig, variant: number): string {
  if (cfg.isFriendly) {
    return (
      pickPhraseId('prematch', 'commentator', variant, (p) => p.id.includes('.setting_friendly.')) ??
      'phrase.commentator.prematch.setting_friendly.01'
    );
  }

  if (cfg.leagueId === 'international-cup') {
    if (cfg.cupRoundName) {
      const round = cfg.cupRoundName.toLowerCase();
      if (round.includes('final') && !round.includes('semi') && !round.includes('quarter')) {
        return (
          pickPhraseId('prematch', 'commentator', variant, (p) => p.id.includes('.setting_intl_final.')) ??
          'phrase.commentator.prematch.setting_intl_final.01'
        );
      }
      if (round.includes('semi-final')) {
        return (
          pickPhraseId('prematch', 'commentator', variant, (p) => p.id.includes('.setting_intl_sf.')) ??
          'phrase.commentator.prematch.setting_intl_sf.01'
        );
      }
      if (round.includes('quarter-final')) {
        return (
          pickPhraseId('prematch', 'commentator', variant, (p) => p.id.includes('.setting_intl_qf.')) ??
          'phrase.commentator.prematch.setting_intl_qf.01'
        );
      }
      return (
        pickPhraseId('prematch', 'commentator', variant, (p) => p.id.includes('.setting_intl_ko.')) ??
        'phrase.commentator.prematch.setting_intl_ko.01'
      );
    }
    return (
      pickPhraseId('prematch', 'commentator', variant, (p) => p.id.includes('.setting_intl_gp.')) ??
      'phrase.commentator.prematch.setting_intl_gp.01'
    );
  }

  if (cfg.cupRoundName) {
    const round = cfg.cupRoundName.toLowerCase();
    if (round.includes('final') && !round.includes('semi') && !round.includes('quarter')) {
      return (
        pickPhraseId('prematch', 'commentator', variant, (p) => p.id.includes('.setting_cup_final.')) ??
        'phrase.commentator.prematch.setting_cup_final.01'
      );
    }
    if (round.includes('semi-final')) {
      return (
        pickPhraseId('prematch', 'commentator', variant, (p) => p.id.includes('.setting_cup_sf.')) ??
        'phrase.commentator.prematch.setting_cup_sf.01'
      );
    }
    if (round.includes('quarter-final')) {
      return (
        pickPhraseId('prematch', 'commentator', variant, (p) => p.id.includes('.setting_cup_qf.')) ??
        'phrase.commentator.prematch.setting_cup_qf.01'
      );
    }
    return (
      pickPhraseId('prematch', 'commentator', variant, (p) => p.id.includes('.setting_cup_early.')) ??
      'phrase.commentator.prematch.setting_cup_early.01'
    );
  }

  // League match standings reference
  if (typeof cfg.homePosition === 'number' && typeof cfg.awayPosition === 'number') {
    const hp = cfg.homePosition;
    const ap = cfg.awayPosition;
    if (hp <= 5 && ap <= 5) {
      return (
        pickPhraseId('prematch', 'commentator', variant, (p) => p.id.includes('.setting_league_top.')) ??
        'phrase.commentator.prematch.setting_league_top.01'
      );
    }
    if (hp >= 16 && ap >= 16) {
      return (
        pickPhraseId('prematch', 'commentator', variant, (p) => p.id.includes('.setting_league_bottom.')) ??
        'phrase.commentator.prematch.setting_league_bottom.01'
      );
    }
    if ((hp <= 5 && ap >= 16) || (ap <= 5 && hp >= 16)) {
      return (
        pickPhraseId('prematch', 'commentator', variant, (p) => p.id.includes('.setting_league_gap.')) ??
        'phrase.commentator.prematch.setting_league_gap.01'
      );
    }
  }

  // General league settings
  return (
    pickPhraseId('prematch', 'commentator', variant, (p) => p.id.includes('.setting_league_gen.')) ??
    'phrase.commentator.prematch.setting_league_gen.01'
  );
}

export function pickPunditOutlookPhrase(cfg: MatchConfig, variant: number): string {
  if (cfg.isFriendly) {
    return (
      pickPhraseId('prematch', 'pundit', variant, (p) => p.id.includes('.outlook_friendly.')) ??
      'phrase.pundit.prematch.outlook_friendly.01'
    );
  }

  if (cfg.leagueId === 'international-cup') {
    if (cfg.cupRoundName) {
      const round = cfg.cupRoundName.toLowerCase();
      if (round.includes('final') && !round.includes('semi') && !round.includes('quarter')) {
        return (
          pickPhraseId('prematch', 'pundit', variant, (p) => p.id.includes('.outlook_intl_final.')) ??
          'phrase.pundit.prematch.outlook_intl_final.01'
        );
      }
      if (round.includes('semi-final')) {
        return (
          pickPhraseId('prematch', 'pundit', variant, (p) => p.id.includes('.outlook_intl_sf.')) ??
          'phrase.pundit.prematch.outlook_intl_sf.01'
        );
      }
      if (round.includes('quarter-final')) {
        return (
          pickPhraseId('prematch', 'pundit', variant, (p) => p.id.includes('.outlook_intl_qf.')) ??
          'phrase.pundit.prematch.outlook_intl_qf.01'
        );
      }
      return (
        pickPhraseId('prematch', 'pundit', variant, (p) => p.id.includes('.outlook_intl_ko.')) ??
        'phrase.pundit.prematch.outlook_intl_ko.01'
      );
    }
    return (
      pickPhraseId('prematch', 'pundit', variant, (p) => p.id.includes('.outlook_intl_gp.')) ??
      'phrase.pundit.prematch.outlook_intl_gp.01'
    );
  }

  if (cfg.cupRoundName) {
    const round = cfg.cupRoundName.toLowerCase();
    if (round.includes('final') && !round.includes('semi') && !round.includes('quarter')) {
      return (
        pickPhraseId('prematch', 'pundit', variant, (p) => p.id.includes('.outlook_cup_final.')) ??
        'phrase.pundit.prematch.outlook_cup_final.01'
      );
    }
    if (round.includes('semi-final')) {
      return (
        pickPhraseId('prematch', 'pundit', variant, (p) => p.id.includes('.outlook_cup_sf.')) ??
        'phrase.pundit.prematch.outlook_cup_sf.01'
      );
    }
    if (round.includes('quarter-final')) {
      return (
        pickPhraseId('prematch', 'pundit', variant, (p) => p.id.includes('.outlook_cup_qf.')) ??
        'phrase.pundit.prematch.outlook_cup_qf.01'
      );
    }
    return (
      pickPhraseId('prematch', 'pundit', variant, (p) => p.id.includes('.outlook_cup_early.')) ??
      'phrase.pundit.prematch.outlook_cup_early.01'
    );
  }

  // League match standings reference
  if (typeof cfg.homePosition === 'number' && typeof cfg.awayPosition === 'number') {
    const hp = cfg.homePosition;
    const ap = cfg.awayPosition;
    if (hp <= 5 && ap <= 5) {
      return (
        pickPhraseId('prematch', 'pundit', variant, (p) => p.id.includes('.outlook_league_top.')) ??
        'phrase.pundit.prematch.outlook_league_top.01'
      );
    }
    if (hp >= 16 && ap >= 16) {
      return (
        pickPhraseId('prematch', 'pundit', variant, (p) => p.id.includes('.outlook_league_bottom.')) ??
        'phrase.pundit.prematch.outlook_league_bottom.01'
      );
    }
    if ((hp <= 5 && ap >= 16) || (ap <= 5 && hp >= 16)) {
      return (
        pickPhraseId('prematch', 'pundit', variant, (p) => p.id.includes('.outlook_league_gap.')) ??
        'phrase.pundit.prematch.outlook_league_gap.01'
      );
    }
  }

  // General league outlooks
  return (
    pickPhraseId('prematch', 'pundit', variant, (p) => p.id.includes('.outlook_league_gen.')) ??
    'phrase.pundit.prematch.outlook_league_gen.01'
  );
}

export function buildMatchIntroSequence(cfg: MatchConfig, variant = 0): string[] {
  return buildMatchIntroLines(cfg, variant)[0]?.ids ?? [];
}

export function buildMatchIntroLines(cfg: MatchConfig, variant = 0): CommentaryLine[] {
  const home = cfg.teams[0].data;
  const away = cfg.teams[1].data;
  const setting = pickSettingPhrase(cfg, variant);
  const openers = [
    [
      'phrase.commentator.prematch.self_intro.01',
      'phrase.commentator.prematch.at_stadium.01',
      stadiumNameClipId(home.id),
      'phrase.commentator.prematch.between.01',
      teamNameClipId(home.id, 'calm'),
      'phrase.commentator.prematch.and.01',
      teamNameClipId(away.id, 'calm'),
      setting,
    ],
    [
      'phrase.commentator.prematch.welcome.01',
      stadiumNameClipId(home.id),
      'phrase.commentator.prematch.self_intro.01',
      'phrase.commentator.prematch.fixture.01',
      teamNameClipId(home.id, 'calm'),
      'phrase.commentator.prematch.and.01',
      teamNameClipId(away.id, 'calm'),
      setting,
    ],
    [
      'phrase.commentator.prematch.self_intro.01',
      'phrase.commentator.prematch.at_stadium.01',
      stadiumNameClipId(home.id),
      'phrase.commentator.prematch.fixture.01',
      teamNameClipId(home.id, 'calm'),
      'phrase.commentator.prematch.and.01',
      teamNameClipId(away.id, 'calm'),
      'phrase.commentator.prematch.pundit_question.01',
    ],
    [
      'phrase.commentator.prematch.welcome.01',
      stadiumNameClipId(home.id),
      'phrase.commentator.prematch.between.01',
      teamNameClipId(home.id, 'calm'),
      'phrase.commentator.prematch.and.01',
      teamNameClipId(away.id, 'calm'),
      setting,
    ],
    [
      'phrase.commentator.prematch.self_intro.01',
      'phrase.commentator.prematch.fixture.01',
      teamNameClipId(home.id, 'calm'),
      'phrase.commentator.prematch.and.01',
      teamNameClipId(away.id, 'calm'),
      'phrase.commentator.prematch.at_stadium.01',
      stadiumNameClipId(home.id),
      setting,
    ],
    [
      'phrase.commentator.prematch.welcome.01',
      stadiumNameClipId(home.id),
      'phrase.commentator.prematch.pundit_question.01',
    ],
  ];
  const introIds = openers[Math.abs(variant) % openers.length];
  return [
    line(introIds, 'commentator', 4, 'match-intro'),
    line([pickPunditOutlookPhrase(cfg, variant)], 'pundit', 3, 'match-intro-pundit'),
  ];
}

export function buildPrematchLineupLines(cfg: MatchConfig, variant = 0): CommentaryLine[] {
  const home = cfg.teams[0].data;
  const away = cfg.teams[1].data;
  const lines: CommentaryLine[] = [
    line([
      'phrase.commentator.prematch.at_stadium.01',
      stadiumNameClipId(home.id),
      'phrase.commentator.prematch.between.01',
      teamNameClipId(home.id, 'calm'),
      'phrase.commentator.prematch.and.01',
      teamNameClipId(away.id, 'calm'),
    ], 'commentator', 4, 'prematch-lineups-opener'),
  ];
  for (const teamIdx of [0, 1] as const) {
    const team = cfg.teams[teamIdx];
    const keyPlayer = keyLineupPlayer(cfg, teamIdx);
    const teamId = team.data.id;
    if (!keyPlayer) continue;
    lines.push(line([
      'phrase.commentator.dialogue.ask.01',
      availablePlayerFullNameClipId(teamId, keyPlayer.attrs.name, 'calm'),
      'phrase.commentator.dialogue.ask.02',
    ], 'commentator', 3, `prematch-player-${teamId}`));
    const pos = keyPlayer.attrs.pos.toLowerCase();
    lines.push(line([
      pickPhraseId('dialogue', 'pundit', variant + teamIdx, (p) => p.id.includes(`.${pos}.`))
        ?? `phrase.pundit.dialogue.${pos}.01`,
    ], 'pundit', 3, `prematch-player-analysis-${teamId}`));
  }
  lines.push(line([
    'phrase.commentator.prematch.head_to.01',
    stadiumNameClipId(home.id),
  ], 'commentator', 4, 'prematch-handoff'));
  return lines;
}

export function buildEventCommentaryLines(
  events: SimEvent[],
  state: MatchState,
  cfg: MatchConfig,
  variant = 0,
): CommentaryLine[] {
  if (!events.length) return [];

  const goal = events.find((e) => e.type === 'goal');
  if (goal) return buildGoalLines(goal, state, cfg, variant);

  const penalty = events.find((e) => e.type === 'penalty');
  if (penalty) return [
    line([pickPhraseId('penalty', 'commentator', variant) ?? 'phrase.commentator.setpiece.penalty.01'], 'commentator', 9, 'penalty'),
    line([pickPhraseId('analysis', 'pundit', variant, (p) => p.id.includes('.penalty.') || p.id.includes('.penalty_extra.')) ?? 'phrase.pundit.analysis.penalty.01'], 'pundit', 6, 'penalty-analysis'),
  ];

  const red = events.find((e) => e.type === 'redCard');
  if (red) return buildPlayerDecisionLine(red, state, cfg, 'redCard', 8, variant);

  const yellow = events.find((e) => e.type === 'yellowCard');
  if (yellow) return buildPlayerDecisionLine(yellow, state, cfg, 'yellowCard', 6, variant);

  const foul = events.find((e) => e.type === 'foul');
  if (foul) return [
    ...buildPlayerDecisionLine(foul, state, cfg, 'foul', 6, variant),
    line([pickPhraseId('analysis', 'pundit', variant, (p) => p.id.includes('.foul.') || p.id.includes('.foul_extra.')) ?? 'phrase.pundit.analysis.foul.01'], 'pundit', 3, 'foul-analysis'),
  ];

  const offside = events.find((e) => e.type === 'offside');
  if (offside) return [
    ...buildPlayerDecisionLine(offside, state, cfg, 'offside', 5, variant),
    line([pickPhraseId('analysis', 'pundit', variant, (p) => p.id.includes('.offside.') || p.id.includes('.offside_extra.')) ?? 'phrase.pundit.analysis.offside.01'], 'pundit', 3, 'offside-analysis'),
  ];

  if (events.some((e) => e.type === 'halfTime')) {
    return [
      line([pickPhraseId('halfTime', 'commentator', variant) ?? 'phrase.commentator.time.half_time.01'], 'commentator', 7, 'half-time'),
      line([
        pickPhraseId('analysis', 'pundit', variant, (p) => p.id.includes('.half_time.') || p.id.includes('.half_time_extra.'))
          ?? 'phrase.pundit.analysis.half_time.01',
      ], 'pundit', 4, 'half-time-analysis'),
    ];
  }

  if (events.some((e) => e.type === 'fullTime' || e.type === 'matchEnd')) {
    return buildFullTimeLines(state, cfg, variant);
  }

  if (events.some((e) => e.type === 'post')) {
    return [line([pickPhraseId('post', 'commentator', variant) ?? 'phrase.commentator.post.01'], 'commentator', 7, 'post')];
  }

  if (events.some((e) => e.type === 'save')) {
    return [
      line([pickPhraseId('save', 'commentator', variant) ?? 'phrase.commentator.save.01'], 'commentator', 6, 'save'),
      line([pickPhraseId('analysis', 'pundit', variant, (p) => p.id.includes('.save.') || p.id.includes('.save_extra.')) ?? 'phrase.pundit.analysis.save.01'], 'pundit', 3, 'save-analysis'),
    ];
  }

  if (events.some((e) => e.type === 'nearMiss')) {
    return [line([pickPhraseId('nearMiss', 'commentator', variant) ?? 'phrase.commentator.near_miss.01'], 'commentator', 6, 'near-miss')];
  }

  if (events.some((e) => e.type === 'shot')) {
    return [line([pickPhraseId('shot', 'commentator', variant) ?? 'phrase.commentator.shot.01'], 'commentator', 4, 'shot')];
  }

  const pass = events.find((e) => e.type === 'pass' && typeof e.target === 'number');
  if (pass) {
    const passLine = buildPassLine(pass, state, cfg, variant);
    if (passLine) return [passLine];
  }

  if (events.some((e) => e.type === 'out')) {
    const category = state.phase === 'corner' ? 'corner' : state.phase === 'goalKick' ? 'goalKick' : state.phase === 'throwIn' ? 'throwIn' : null;
    if (category) return [line([pickPhraseId(category, 'commentator', variant) ?? `phrase.commentator.setpiece.${category}.01`], 'commentator', 3, category)];
  }

  if (events.some((e) => e.type === 'kickoff')) {
    return [line([pickPhraseId('kickoff', 'commentator', variant) ?? 'phrase.commentator.kickoff.start.01'], 'commentator', 3, 'kickoff')];
  }

  return [];
}

export function buildAmbientCommentaryLines(
  state: MatchState,
  cfg: MatchConfig,
  variant = 0,
): CommentaryLine[] {
  if (state.phase !== 'play' || state.ball.ownerIdx < 0) return [];
  const owner = state.players[state.ball.ownerIdx];
  if (!owner || owner.sentOff) return [];

  if (variant % 5 === 0) {
    const teamId = cfg.teams[owner.team].data.id;
    const pos = owner.attrs.pos.toLowerCase();
    const punditId = pickPhraseId('dialogue', 'pundit', variant, (p) => p.id.includes(`.${pos}.`))
      ?? `phrase.pundit.dialogue.${pos}.01`;
    return [
      line([
        'phrase.commentator.dialogue.ask.01',
        availablePlayerFullNameClipId(teamId, owner.attrs.name, 'calm'),
        'phrase.commentator.dialogue.ask.02',
      ], 'commentator', 1, `ambient-dialogue-question-${owner.attrs.pos}`),
      line([punditId], 'pundit', 1, `ambient-dialogue-answer-${owner.attrs.pos}`),
    ];
  }

  const possession = buildPossessionCommentaryLine(state, cfg, variant);
  return possession ? [possession] : [];
}

export function buildPossessionCommentaryLine(
  state: MatchState,
  cfg: MatchConfig,
  variant = 0,
): CommentaryLine | null {
  if (state.phase !== 'play' || state.ball.ownerIdx < 0) return null;
  const owner = state.players[state.ball.ownerIdx];
  if (!owner || owner.sentOff) return null;
  const teamId = cfg.teams[owner.team].data.id;
  const attackingGoalX = state.attackDir[owner.team] > 0 ? 1 : -1;
  const attackingThird = owner.pos.x * attackingGoalX > 18;
  if (attackingThird) {
    return line([pickPhraseId('attack', 'commentator', variant) ?? 'phrase.commentator.attack.01'], 'commentator', 2, 'ambient-attack');
  }
  const byPlayer = variant % 2 === 0;
  if (byPlayer) {
    return line([
      pickPhraseId('possession', 'commentator', variant, (p) => p.id.includes('.player.')) ?? 'phrase.commentator.possession.player.01',
      availablePlayerNameClipId(teamId, owner.attrs.name, 'calm'),
    ], 'commentator', 1, 'ambient-player');
  }
  return line([
    pickPhraseId('possession', 'commentator', variant, (p) => p.id.includes('.team.')) ?? 'phrase.commentator.possession.team.01',
    teamNameClipId(teamId, 'calm'),
  ], 'commentator', 1, 'ambient-team');
}

/** which authored goal-call context fits this moment (score already includes the goal) */
export function goalCallContext(state: MatchState, cfg: MatchConfig, team: 0 | 1): CommentaryPhrase['context'] | null {
  const lead = state.score[team] - state.score[1 - team];
  const minute = approximateMinute(state, cfg);
  if (lead === 0) return 'equalizer';
  if (lead < 0) return 'consolation';
  if (minute >= 82 && lead === 1) return 'late';
  if (minute <= 12) return 'early';
  if (lead === 1) return 'lead';
  return 'extend';
}

function approximateMinute(state: MatchState, cfg: MatchConfig): number {
  const halfLen = state.half <= 2 ? cfg.halfLengthSec : cfg.halfLengthSec / 3;
  const baseMin = state.half === 1 ? 0 : state.half === 2 ? 45 : state.half === 3 ? 90 : 105;
  const spanMin = state.half <= 2 ? 45 : 15;
  return baseMin + Math.min(spanMin, (state.clock / Math.max(1, halfLen)) * spanMin);
}

function buildGoalLines(event: SimEvent, state: MatchState, cfg: MatchConfig, variant: number): CommentaryLine[] {
  const team = event.team ?? 0;
  const teamId = cfg.teams[team].data.id;
  const scorer = playerForEvent(event, state);
  const rotation = Math.floor(Math.abs(variant) / 3);
  // a context-written call (equalizer, late winner...) beats a generic shout
  const context = goalCallContext(state, cfg, team as 0 | 1);
  const direct = (context ? pickPhraseId('goal', 'commentator', rotation, (p) => p.context === context) : null)
    ?? pickPhraseId('goal', 'commentator', variant, (p) => (
      !p.context
      && !p.id.includes('.scorer.')
      && !p.id.includes('.scorer_')
      && !p.id.includes('.for_team.')
      && !p.id.includes('.score_')
    ))
    ?? 'phrase.commentator.goal.01';
  let ids: string[];
  if (variant % 3 === 1 && scorer) {
    ids = [
      direct,
      pickPhraseId('goal', 'commentator', rotation, (p) => p.id.includes('.scorer_only.')) ?? 'phrase.commentator.goal.scorer_only.01',
      availablePlayerFullNameClipId(teamId, scorer.attrs.name, 'big'),
    ];
  } else if (variant % 3 === 2) {
    ids = [
      direct,
      pickPhraseId('goal', 'commentator', rotation, (p) => p.id.includes('.score_now.')) ?? 'phrase.commentator.goal.score_now.01',
      teamNameClipId(cfg.teams[0].data.id, 'big'),
      scoreNumberClipId(state.score[0], 'big'),
      teamNameClipId(cfg.teams[1].data.id, 'big'),
      scoreNumberClipId(state.score[1], 'big'),
    ];
  } else {
    ids = [
      direct,
      pickPhraseId('goal', 'commentator', rotation, (p) => p.id.includes('.for_team.')) ?? 'phrase.commentator.goal.for_team.01',
      teamNameClipId(teamId, 'big'),
    ];
    if (scorer) {
      ids.push('phrase.commentator.goal.scorer.01', availablePlayerFullNameClipId(teamId, scorer.attrs.name, 'big'));
    }
  }
  return [
    line(ids, 'commentator', 10, 'goal'),
    line([
      pickPhraseId('analysis', 'pundit', variant, (p) => p.id.includes('.goal.') || p.id.includes('.goal_extra.'))
        ?? 'phrase.pundit.analysis.goal.01',
    ], 'pundit', 5, 'goal-analysis'),
  ];
}

function buildFullTimeLines(state: MatchState, cfg: MatchConfig, variant: number): CommentaryLine[] {
  const fullTime = pickPhraseId('fullTime', 'commentator', variant) ?? 'phrase.commentator.time.full_time.01';
  const scoreline = [
    fullTime,
    teamNameClipId(cfg.teams[0].data.id, 'calm'),
    scoreNumberClipId(state.score[0], 'calm'),
    teamNameClipId(cfg.teams[1].data.id, 'calm'),
    scoreNumberClipId(state.score[1], 'calm'),
  ];
  const margin = Math.abs(state.score[0] - state.score[1]);
  const analysis = state.score[0] === state.score[1]
    ? pickPhraseId('analysis', 'pundit', variant, (p) => p.id.includes('.shape') || p.id.includes('.full_time'))
    : margin >= 3
      ? pickPhraseId('analysis', 'pundit', variant, (p) => p.id.includes('.attack') || p.id.includes('.goal'))
      : pickPhraseId('analysis', 'pundit', variant, (p) => p.id.includes('.full_time') || p.id.includes('.shape'));
  return [
    line(scoreline, 'commentator', 10, 'full-time'),
    line([analysis ?? 'phrase.pundit.analysis.full_time.01'], 'pundit', 5, 'full-time-analysis'),
    line(['phrase.commentator.time.signoff.01'], 'commentator', 4, 'full-time-signoff'),
  ];
}

function buildPlayerDecisionLine(
  event: SimEvent,
  state: MatchState,
  cfg: MatchConfig,
  category: string,
  priority: number,
  variant: number,
): CommentaryLine[] {
  const ids = [pickPhraseId(category, 'commentator', variant) ?? `phrase.commentator.${category}.01`];
  const player = playerForEvent(event, state);
  const nameIntensity: CommentaryIntensity = category === 'redCard'
    ? 'big'
    : category === 'yellowCard' || category === 'foul'
      ? 'excited'
      : 'calm';
  if (player) ids.push(availablePlayerFullNameClipId(cfg.teams[player.team].data.id, player.attrs.name, nameIntensity));
  return [line(ids, 'commentator', priority, category)];
}

function pickGenericPassPhrase(variant: number): string {
  return pickPhraseId(
    'pass',
    'commentator',
    variant,
    (p) =>
      !p.id.includes('.to.') &&
      !p.id.includes('.tries_find.') &&
      !p.id.includes('.now_has.') &&
      !p.id.includes('.picks_out.') &&
      !p.id.includes('.into_feet.') &&
      !p.id.includes('.has_it.')
  ) ?? 'phrase.commentator.pass.01';
}

function buildPassLine(event: SimEvent, state: MatchState, cfg: MatchConfig, variant: number): CommentaryLine | null {
  if (typeof event.player !== 'number' || typeof event.target !== 'number') return null;
  const passer = state.players[event.player];
  const receiver = state.players[event.target];
  if (!passer || !receiver || passer.sentOff || receiver.sentOff || passer.team !== receiver.team) return null;
  const teamId = cfg.teams[passer.team].data.id;
  const passerId = availablePlayerNameClipId(teamId, passer.attrs.name, 'calm');
  const receiverId = availablePlayerNameClipId(teamId, receiver.attrs.name, 'calm');

  // Check if we have the clips for both players
  const hasPasserClip = availableClipIds?.has(passerId) ?? true;
  const hasReceiverClip = availableClipIds?.has(receiverId) ?? true;
  
  // Occasionally fall back to a generic pass call, but keep the first rotation
  // on the spliceable player-name structures for tighter in-play commentary.
  const useGeneric = (Math.abs(variant) % 5 === 4) || !hasPasserClip || !hasReceiverClip;

  if (useGeneric) {
    const phraseId = pickGenericPassPhrase(variant);
    return line([phraseId], 'commentator', 2, 'pass');
  }

  // structure by variant, connector phrase rotates within the structure's pool
  const style = Math.abs(variant) % 4;
  const rotation = Math.floor(Math.abs(variant) / 4);
  const connector = (path: string, fallback: string) =>
    pickPhraseId('pass', 'commentator', rotation, (p) => p.id.includes(path)) ?? fallback;
  const ids = style === 1
    ? [passerId, connector('.pass.tries_find.', 'phrase.commentator.pass.tries_find.01'), receiverId]
    : style === 2
      ? [connector('.pass.now_has.', 'phrase.commentator.pass.now_has.01'), receiverId, 'phrase.commentator.pass.has_it.01']
      : style === 3
        ? [passerId, connector('.pass.picks_out.', 'phrase.commentator.pass.picks_out.01'), receiverId]
        : [passerId, connector('.pass.to.', 'phrase.commentator.pass.to.01'), receiverId];
  return line(ids, 'commentator', 2, 'pass');
}

function clampScoreNumber(score: number): number {
  return Math.max(0, Math.min(9, Math.floor(Number.isFinite(score) ? score : 0)));
}

function playerForEvent(event: SimEvent, state: MatchState): SimPlayer | null {
  if (typeof event.player !== 'number') return null;
  return state.players[event.player] ?? null;
}

function keyLineupPlayer(cfg: MatchConfig, teamIdx: 0 | 1): { attrs: SimPlayer['attrs']; squadIdx: number } | null {
  const team = cfg.teams[teamIdx];
  const preferred = ['FW', 'MF', 'DF', 'GK'];
  for (const pos of preferred) {
    const squadIdx = team.lineup.starters.find((idx) => team.data.players[idx]?.pos === pos);
    if (typeof squadIdx === 'number') return { attrs: team.data.players[squadIdx], squadIdx };
  }
  const squadIdx = team.lineup.starters[0];
  return typeof squadIdx === 'number' && team.data.players[squadIdx]
    ? { attrs: team.data.players[squadIdx], squadIdx }
    : null;
}

function line(ids: string[], speaker: CommentarySpeaker, priority: number, cooldownKey: string): CommentaryLine {
  return { ids: ids.filter(Boolean), speaker, priority, cooldownKey };
}

function pickPhraseId(
  category: string,
  speaker: CommentarySpeaker,
  variant: number,
  predicate?: (phrase: CommentaryPhrase) => boolean,
): string | null {
  let pool = COMMENTARY_CATALOG.phrases.filter((p) => p.category === category && p.speaker === speaker && (!predicate || predicate(p)));
  if (availableClipIds) {
    const voiced = pool.filter((p) => availableClipIds!.has(p.id));
    if (voiced.length) pool = voiced;
  }
  if (!pool.length) return null;
  return pool[Math.abs(variant) % pool.length].id;
}

const DEFAULT_CLIP_TIMING: CommentaryClipTiming = {
  durationMs: 600,
  leadingSilenceMs: 0,
  trailingSilenceMs: 0,
};

export function planCommentaryStitches(
  ids: string[],
  manifest: CommentaryManifest,
  timings: Partial<Record<string, CommentaryClipTiming>> = {},
): CommentaryStitchSegment[] {
  const segments: CommentaryStitchSegment[] = [];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const clip = manifest.clips[id];
    if (!clip) continue;
    const timing = timings[id] ?? DEFAULT_CLIP_TIMING;
    const nextId = ids[i + 1];
    const nextClip = nextId ? manifest.clips[nextId] : null;
    const prev = segments.at(-1);
    const prevId = prev?.id;
    const prevJoin = prevId ? joinDelayMs(prevId, id, manifest) : 0;
    const offsetMs = leadingTrimMs(clip, timing);
    const durationMs = Math.max(80, timing.durationMs - offsetMs - trailingTrimMs(clip, timing, nextClip));
    const startMs = prev ? Math.max(0, prev.startMs + prev.durationMs + prevJoin) : 0;
    const nextJoin = nextId ? joinDelayMs(id, nextId, manifest) : 0;

    segments.push({
      id,
      startMs,
      offsetMs,
      durationMs,
      fadeInMs: prevJoin < 0 ? 10 : 0,
      fadeOutMs: nextJoin < 0 ? 28 : 0,
    });
  }
  return segments;
}

function leadingTrimMs(clip: CommentaryManifestClip, timing: CommentaryClipTiming): number {
  if (clip.kind !== 'phrase') return Math.min(timing.leadingSilenceMs, 12);
  return Math.min(timing.leadingSilenceMs, 110);
}

function trailingTrimMs(
  clip: CommentaryManifestClip,
  timing: CommentaryClipTiming,
  nextClip: CommentaryManifestClip | null,
): number {
  if (clip.kind !== 'phrase' || !nextClip) return 0;
  if (isNameLikeClip(nextClip)) return Math.min(timing.trailingSilenceMs, 150);
  if (nextClip.kind === 'phrase') return Math.min(timing.trailingSilenceMs, 70);
  return Math.min(timing.trailingSilenceMs, 95);
}

function joinDelayMs(prevId: string, nextId: string, manifest: CommentaryManifest): number {
  const prev = manifest.clips[prevId];
  const next = manifest.clips[nextId];
  if (!prev || !next) return 0;
  if (isConnectorPhrase(prevId) && isNameLikeClip(next)) return -deterministicRange(prevId, nextId, 60, 110);
  if (prev.kind === 'phrase' && isNameLikeClip(next)) return -35;
  if (prev.kind === 'phrase' && next.kind === 'phrase') return 25;
  if (isNameLikeClip(prev) && next.kind === 'phrase') return 18;
  if (prev.kind === 'number' || next.kind === 'number') return 30;
  return 10;
}

function isNameLikeClip(clip: CommentaryManifestClip): boolean {
  return clip.kind === 'team'
    || clip.kind === 'stadium'
    || clip.kind === 'player'
    || clip.kind === 'playerFull'
    || clip.kind === 'number';
}

function isConnectorPhrase(id: string): boolean {
  return id.includes('.pass.to.')
    || id.includes('.pass.tries_find.')
    || id.includes('.pass.picks_out.')
    || id.includes('.pass.now_has.')
    || id.includes('.prematch.and.')
    || id.includes('.prematch.between.')
    || id.includes('.prematch.fixture.')
    || id.includes('.prematch.at_stadium.')
    || id.includes('.prematch.head_to.')
    || id.includes('.dialogue.ask.')
    || id.includes('.goal.for_team.')
    || id.includes('.goal.scorer.')
    || id.includes('.goal.score_now.')
    || id.includes('.time.full_time.');
}

function deterministicRange(a: string, b: string, min: number, max: number): number {
  let hash = 2166136261;
  const text = `${a}|${b}`;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return min + (Math.abs(hash) % (max - min + 1));
}

interface QueuedCommentaryLine extends CommentaryLine {
  queuedAt: number;
}

/** how long a queued line stays worth saying, by how big the moment was */
function staleAfterSeconds(priority: number): number {
  if (priority >= 8) return 6.0; // goals, cards: still worth hearing a beat late
  if (priority >= 6) return 4.0; // shots, saves
  return 2.2; // passing chatter goes stale almost immediately
}

export class CommentaryEngine {
  private ctx: AudioContext;
  private manifest: CommentaryManifest | null;
  private baseUrl: string;
  private gain: GainNode;
  private buffers = new Map<string, AudioBuffer | null>();
  private clipTimings = new Map<string, CommentaryClipTiming>();
  private queue: QueuedCommentaryLine[] = [];
  private playing = false;
  private currentSources = new Set<AudioBufferSourceNode>();
  private currentPriority = 0;
  private playToken = 0;
  private stopped = false;
  private cooldowns = new Map<string, number>();
  private ambientTimer = 0;
  private variant = 0;
  private recentPhraseIds: string[] = [];
  private lastAmbientOwnerIdx = -1;
  private lastLineSpeaker: CommentarySpeaker | null = null;

  volume = 0.85;

  constructor(assets: GameAssets) {
    this.ctx = assets.audioCtx;
    this.manifest = assets.commentaryManifest ?? null;
    this.baseUrl = assets.baseUrl;
    this.gain = this.ctx.createGain();
    this.gain.gain.value = this.volume;
    this.gain.connect(this.ctx.destination);
    // pickers should only choose lines that have voiced clips on disk
    setAvailableClipIds(this.manifest ? new Set(Object.keys(this.manifest.clips)) : null);
  }

  setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(1, volume));
    this.gain.gain.value = this.volume;
  }

  startMatch(cfg: MatchConfig) {
    for (const line of buildMatchIntroLines(cfg, this.nextVariant())) this.enqueueLine(line);
  }

  startPrematchPreview(cfg: MatchConfig) {
    const variant = this.nextVariant();
    for (const line of buildPrematchLineupLines(cfg, variant)) this.enqueueLine(line);
  }

  waitUntilIdle(timeoutMs = Number.POSITIVE_INFINITY): Promise<void> {
    const start = performance.now();
    return new Promise((resolve) => {
      const poll = () => {
        const timedOut = Number.isFinite(timeoutMs) && performance.now() - start >= timeoutMs;
        if (this.stopped || timedOut || (!this.playing && this.queue.length === 0)) {
          resolve();
          return;
        }
        window.setTimeout(poll, 120);
      };
      poll();
    });
  }

  isIdle(): boolean {
    return !this.playing && this.queue.length === 0;
  }

  handleEvents(events: SimEvent[], state: MatchState, cfg: MatchConfig) {
    for (const line of this.withFreshPhrases((v) => buildEventCommentaryLines(events, state, cfg, v))) {
      this.enqueueLine(line);
    }
  }

  update(dt: number, state: MatchState, cfg: MatchConfig) {
    if (!this.manifest || this.playing || this.queue.length) return;
    this.ambientTimer += dt;
    if (this.ambientTimer < 7) return;
    this.ambientTimer = 0;
    const owner = state.ball.ownerIdx;
    const lines = this.withFreshPhrases((v) => {
      // don't introduce the same man on the ball twice in a row
      const variant = owner >= 0 && owner === this.lastAmbientOwnerIdx && v % 2 === 0 ? v + 1 : v;
      return buildAmbientCommentaryLines(state, cfg, variant);
    });
    if (lines.length) this.lastAmbientOwnerIdx = owner;
    for (const line of lines) this.enqueueLine(line);
  }

  /** retry the builder with different variants when it lands on recently used phrases */
  private withFreshPhrases(build: (variant: number) => CommentaryLine[]): CommentaryLine[] {
    let lines: CommentaryLine[] = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      lines = build(this.nextVariant());
      const phraseIds = lines.flatMap((l) => l.ids.filter((id) => id.startsWith('phrase.')));
      const stale = phraseIds.some((id) => this.recentPhraseIds.includes(id));
      const critical = lines.some((l) => l.priority >= 8);
      if (!stale || critical) break;
    }
    for (const l of lines) {
      for (const id of l.ids) {
        if (id.startsWith('phrase.')) this.recentPhraseIds.push(id);
      }
    }
    if (this.recentPhraseIds.length > 14) {
      this.recentPhraseIds = this.recentPhraseIds.slice(-14);
    }
    return lines;
  }

  stop() {
    this.stopped = true;
    this.queue = [];
    this.playToken++;
    for (const source of this.currentSources) {
      try { source.stop(); } catch {}
    }
    this.currentSources.clear();
  }

  private enqueueLine(lineToQueue: CommentaryLine) {
    if (!this.manifest || this.stopped || !lineToQueue.ids.length) return;
    const now = this.ctx.currentTime;
    const cooldownUntil = this.cooldowns.get(lineToQueue.cooldownKey) ?? 0;
    if (cooldownUntil > now && lineToQueue.priority < 8) return;
    this.cooldowns.set(lineToQueue.cooldownKey, now + cooldownFor(lineToQueue));

    if (lineToQueue.priority >= 6) {
      this.queue = this.queue.filter((queued) => queued.priority >= lineToQueue.priority && queued.priority >= 6);
      if (this.playing && this.currentPriority < lineToQueue.priority) this.interruptCurrent();
      else if (this.playing && this.currentPriority < 6) this.interruptCurrent();
    }

    const item: QueuedCommentaryLine = { ...lineToQueue, queuedAt: now };
    if (lineToQueue.priority >= 8) this.queue.unshift(item);
    else this.queue.push(item);
    this.queue = this.queue
      .sort((a, b) => b.priority - a.priority || a.queuedAt - b.queuedAt)
      .slice(0, 4);
    void this.playNext();
  }

  private async playNext() {
    if (this.playing || this.stopped) return;
    // drop lines that went stale while waiting — commentary arriving 10s
    // after a quick passing move reads as the feed lagging the match
    const now = this.ctx.currentTime;
    let next = this.queue.shift();
    while (next && now - next.queuedAt > staleAfterSeconds(next.priority)) {
      next = this.queue.shift();
    }
    if (!next) return;
    this.playing = true;
    this.currentPriority = next.priority;
    const token = this.playToken;
    try {
      // a beat before the co-commentator comes in reads as conversation
      if (next.speaker === 'pundit' && this.lastLineSpeaker === 'commentator') {
        await wait(280 + Math.random() * 240);
      } else if (next.speaker === 'commentator' && this.lastLineSpeaker === 'pundit') {
        await wait(160 + Math.random() * 140);
      }
      if (token !== this.playToken) return;
      const playable = await this.loadPlayableClips(next.ids, token);
      if (token !== this.playToken) return;
      if (playable.length) await this.playStitchedLine(playable, token);
      this.lastLineSpeaker = next.speaker;
    } finally {
      this.playing = false;
      this.currentPriority = 0;
      if (!this.stopped) void this.playNext();
    }
  }

  private interruptCurrent() {
    this.playToken++;
    for (const source of this.currentSources) {
      try { source.stop(); } catch {}
    }
    this.currentSources.clear();
  }

  private async loadPlayableClips(ids: string[], token: number): Promise<{ id: string; buffer: AudioBuffer }[]> {
    const playable: { id: string; buffer: AudioBuffer }[] = [];
    for (const id of ids) {
      if (this.stopped || token !== this.playToken) break;
      const buffer = await this.loadClip(id);
      if (token !== this.playToken) break;
      if (buffer) playable.push({ id, buffer });
    }
    return playable;
  }

  private async loadClip(id: string): Promise<AudioBuffer | null> {
    if (this.buffers.has(id)) return this.buffers.get(id) ?? null;
    const clip = this.manifest?.clips[id];
    if (!clip) {
      this.buffers.set(id, null);
      return null;
    }
    try {
      const res = await fetch(`${this.baseUrl}${clip.src}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const arr = await res.arrayBuffer();
      const buffer = await this.ctx.decodeAudioData(arr.slice(0));
      this.buffers.set(id, buffer);
      this.clipTimings.set(id, measureBufferTiming(buffer));
      return buffer;
    } catch (e) {
      console.warn('commentary clip failed', id, e);
      this.buffers.set(id, null);
      return null;
    }
  }

  private playStitchedLine(playable: { id: string; buffer: AudioBuffer }[], token: number): Promise<void> {
    if (!this.manifest) return Promise.resolve();
    const buffers = new Map(playable.map((clip) => [clip.id, clip.buffer]));
    const timings: Record<string, CommentaryClipTiming> = {};
    for (const { id, buffer } of playable) {
      timings[id] = this.clipTimings.get(id) ?? measureBufferTiming(buffer);
      this.clipTimings.set(id, timings[id]);
    }
    const plan = planCommentaryStitches(playable.map((clip) => clip.id), this.manifest, timings);
    if (!plan.length) return Promise.resolve();

    return new Promise((resolve) => {
      let settled = false;
      let active = 0;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const baseTime = this.ctx.currentTime + 0.025;
      let latestEndMs = 0;
      for (const segment of plan) {
        if (this.stopped || token !== this.playToken) break;
        const buffer = buffers.get(segment.id);
        if (!buffer) continue;
        const offsetSec = Math.min(Math.max(0, buffer.duration - 0.03), Math.max(0, segment.offsetMs / 1000));
        const durationSec = Math.min(
          Math.max(0.05, segment.durationMs / 1000),
          Math.max(0.05, buffer.duration - offsetSec),
        );
        const startAt = baseTime + segment.startMs / 1000;
        const endAt = startAt + durationSec;
        latestEndMs = Math.max(latestEndMs, segment.startMs + durationSec * 1000);

        const src = this.ctx.createBufferSource();
        const clipGain = this.ctx.createGain();
        src.buffer = buffer;
        src.connect(clipGain);
        clipGain.connect(this.gain);
        configureClipGain(clipGain.gain, startAt, endAt, segment.fadeInMs, segment.fadeOutMs);
        this.currentSources.add(src);
        active++;
        src.onended = () => {
          this.currentSources.delete(src);
          active--;
          if (active <= 0) done();
        };
        try {
          src.start(startAt, offsetSec, durationSec);
        } catch {
          this.currentSources.delete(src);
          active--;
        }
      }
      if (active <= 0) done();
      window.setTimeout(done, Math.ceil(latestEndMs) + 300);
    });
  }

  private nextVariant(): number {
    const v = this.variant;
    // uneven stride so phrase rotation never settles into a fixed cycle
    this.variant = (this.variant + 1 + Math.floor(Math.random() * 3)) % 997;
    return v;
  }
}

function cooldownFor(lineToQueue: CommentaryLine): number {
  if (lineToQueue.priority >= 8) return 2;
  if (lineToQueue.cooldownKey === 'pass') return 2.2;
  if (lineToQueue.cooldownKey.startsWith('ambient')) return 14;
  if (lineToQueue.cooldownKey.includes('analysis')) return 12;
  return 5;
}

function measureBufferTiming(buffer: AudioBuffer): CommentaryClipTiming {
  const data = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate || 44100;
  const windowSize = Math.max(128, Math.floor(sampleRate * 0.012));
  const threshold = 0.0085;
  const leadingSamples = findFirstAudibleSample(data, windowSize, threshold);
  const trailingSamples = data.length - findLastAudibleSample(data, windowSize, threshold);
  return {
    durationMs: buffer.duration * 1000,
    leadingSilenceMs: (leadingSamples / sampleRate) * 1000,
    trailingSilenceMs: (Math.max(0, trailingSamples) / sampleRate) * 1000,
  };
}

function findFirstAudibleSample(data: Float32Array, windowSize: number, threshold: number): number {
  for (let i = 0; i < data.length; i += windowSize) {
    if (windowRms(data, i, Math.min(data.length, i + windowSize)) > threshold) return i;
  }
  return 0;
}

function findLastAudibleSample(data: Float32Array, windowSize: number, threshold: number): number {
  for (let end = data.length; end > 0; end -= windowSize) {
    const start = Math.max(0, end - windowSize);
    if (windowRms(data, start, end) > threshold) return end;
  }
  return data.length;
}

function windowRms(data: Float32Array, start: number, end: number): number {
  let sum = 0;
  const count = Math.max(1, end - start);
  for (let i = start; i < end; i++) sum += data[i] * data[i];
  return Math.sqrt(sum / count);
}

function configureClipGain(
  gain: AudioParam,
  startAt: number,
  endAt: number,
  fadeInMs: number,
  fadeOutMs: number,
) {
  const fadeInSec = Math.max(0, Math.min(fadeInMs / 1000, Math.max(0, endAt - startAt) * 0.35));
  const fadeOutSec = Math.max(0, Math.min(fadeOutMs / 1000, Math.max(0, endAt - startAt) * 0.35));
  try {
    gain.cancelScheduledValues(startAt);
    if (fadeInSec > 0) {
      gain.setValueAtTime(0.001, startAt);
      gain.linearRampToValueAtTime(1, startAt + fadeInSec);
    } else {
      gain.setValueAtTime(1, startAt);
    }
    if (fadeOutSec > 0) {
      gain.setValueAtTime(1, Math.max(startAt, endAt - fadeOutSec));
      gain.linearRampToValueAtTime(0.001, endAt);
    }
  } catch {
    gain.value = 1;
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
