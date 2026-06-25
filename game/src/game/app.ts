import { loadAssets, type GameAssets } from '../engine/assets';
import { AudioEngine } from '../engine/audio';
import { CommentaryEngine } from '../engine/commentary';
import { InputManager } from '../engine/input';
import { pickKits } from '../engine/kitTint';
import type { PitchBoardCreative } from '../engine/stadium';
import { TEAMS } from '../data/teams';
import { setActiveLeague, setCupTeams, allNations } from '../data/leagues';
import { GROUPS_BY_ID, WORLD_CUP_VENUES } from '../data/worldCup';
import { autoLineup, normalizeLineupForFormation, normalizeTactics, teamDefaultLineup } from '../sim/formations';
import type { KitColors, Lineup, MatchConfig, MatchTeamConfig, MatchTimeOfDay, MatchWeather } from '../sim/types';
import { Hud } from '../ui/hud';
import { UI } from '../ui/screens';
import {
  careerHub, tableScreen, bracketScreen, squadScreen, transferScreen, trainingScreen, seasonSummary,
  headlinesScreen, teamScreen,
} from '../ui/careerScreens';
import {
  advance, currentEvent, newCareer, userFixture, leagueTable, userStarterForm,
  careerMomentumForTeam, careerStarterIndexes, isPlayerUnavailable, recordCareerMatchMomentum, type Career, type CareerMode,
} from './career';
import {
  seedTournamentInbox, recordUserMatchForm, pushResultMessages, generateRoundMeta,
  applyMoraleDelta, buildContext, userManagerName, userTeamName, sanitizeManagerName, recordPressConferenceNarrative,
} from './cupMeta';
import { mountPhone, mountPressConference, buildPressConference, mountEvent, type MetaEvent, type PressTone } from '../meta';
import { unresolvedRequiredMessages } from './cupNarrative';
import type { MatchRunner } from './matchRunner';
import { createAdManager, type AdCreative } from './ads';
import { negotiateBuyPlayer, negotiateSellPlayer } from './transfers';
import { careerSlots, loadCareer, saveCareer, clearCareer, loadSettings, saveSettings, type Settings } from './saves';
import {
  JourneyGame,
  STORY_CAMPAIGNS,
  loadJourney,
  clearJourney,
  storyCampaignById,
  storyModeMenuCopy,
  storySlots,
  type JourneyMatchOutcome,
  type JourneyMatchRequest,
  type JourneyState,
  type StoryCampaignId,
} from '../journey';
import {
  STORY_UNLOCK_COST,
  canAffordStoryUnlock,
  isStoryCampaignUnlocked,
  storyUnlockShortfall,
  unlockStoryCampaign,
} from '../journey/storyUnlocks';
import { buildJourneyMatchConfig } from '../journey/matches';
// Football World — Manager Mode
import {
  managerHub, managerStandings, managerSquad, managerTraining, managerTransfers,
  managerScout, managerPhone, managerHeadlines, managerBoard, managerPress, managerCup,
  seasonEndSummary, jobOffersScreen,
} from '../ui/manager/managerHub';
import {
  createManagerCareer, quickSimUserFixture, advance as advanceManager,
  takeJob, recordUserResult, standingsForUserLeague,
} from './manager/engine';
import { buildManagerMatch } from './manager/match';
import { managerSlots, saveManager, loadManager } from './manager/saves';
import type { ManagerState } from './manager/types';
import { listingsFor, makeBid, offerPlayer, signFreeAgent, assignScout } from './manager/market';
import { setTrainingFocus } from './manager/training';
import { evaluateTarget, jobOffers } from './manager/targets';
import { managerPressConference, applyManagerMorale } from './manager/meta';
import { allNations as allNationDefs, nationById, teamsOf } from '../data/nations';
import { anyTeamById } from '../data/teams';
// Football World — Player Career Mode
import {
  playerHub as playerHubUi, playerStats as playerStatsUi, playerTraining as playerTrainingUi,
  playerHeadlines as playerHeadlinesUi, playerSeasonReview as playerSeasonReviewUi, playerRetired as playerRetiredUi,
} from '../ui/player/playerHub';
import {
  createPlayerCareer, recordPlayerMatch, quickSimPlayerFixture, advancePlayer,
  setPlayerTrainingFocus, playerMoveClub, declineTransfer,
} from './playercareer/engine';
import { buildPlayerMatch } from './playercareer/match';
import { playerSlots, savePlayerCareer, loadPlayerCareer } from './playercareer/saves';
import type { PlayerCareerState, PlayerTrainingFocus } from './playercareer/types';
import type { Pos } from '../sim/types';
// Football World — Customisation Mode
import {
  customiseHub, createTeamScreen, customTeamsScreen, customNationsScreen,
  nationBuilderScreen, exportScreen, importScreen, saveNationFromDraft,
  allPickableTeams, type NationDraft,
} from '../ui/customise/customiseHub';
import { type NetMsg, type NetConfig, type SerializedTeam } from '../net/online';
import { RtcSession, type Role } from '../net/rtc';
import type { NetTransport } from '../net/transport';
import { Rng } from '../sim/rng';
// International Cup Stars (Ultimate-Team) + Seasons ladder + online backend
import { onlineMenu, accountScreen } from '../ui/onlineScreens';
import { starsHub } from '../ui/stars/starsHub';
import { clubScreen } from '../ui/stars/clubScreen';
import { squadBuilder } from '../ui/stars/squadBuilder';
import { storeScreen } from '../ui/stars/storeScreen';
import { coinsChipHtml } from '../ui/stars/components';
import { tradeScreen } from '../ui/stars/tradeScreen';
import { playScreen, showReward } from '../ui/stars/playScreen';
import { worldTourScreen } from '../ui/stars/worldTourScreen';
import { cupStarsScreen } from '../ui/stars/cupStarsScreen';
import { leaderboardScreen } from '../ui/stars/leaderboardScreen';
import { seasonsScreen } from '../ui/seasonsScreens';
import { addCoins, loadStars, saveStars, newStars, setClub } from '../game/stars/store';
import { randomKit, CLUB_RENAME_COST, CLUB_KIT_COST } from '../game/stars/clubRandom';
import { showConfirm, showAlert, showPrompt } from '../ui/modal';
import { starsMatchTeam, squadRating } from '../game/stars/squad';
import { publishMySquad, fetchRealOpponents } from '../game/stars/online';
import { resetIfNewWeek, weekKeyFor } from '../game/stars/weekly';
import { packById, WEEKLY_FREE_PACK } from '../game/stars/economy';
import { canSpendArcadeToken, ensureArcadeTokenGrants, spendArcadeToken } from '../game/stars/arcadeTokens';
import type { StarsState } from '../game/stars/types';
import { grantJourneyRewardCard, journeyRewardMessage } from '../game/stars/journeyReward';
import type { Opponent } from '../game/stars/opponents';
import { WORLD_TOUR_STAGES, applyWorldTourHandicap, recordWorldTourResult, worldTourOpponents } from '../game/stars/worldTour';
import { seasonsSlots, loadSeasons, saveSeasons, newSeasons, type SeasonsState } from '../game/seasons/ladder';
import { getBackend, type BackendService } from '../net/backend';
import { currentUser, signInWithEmail, signOut, onAuthChange, type AuthUser } from '../net/auth';
import { migrateLegacySaves } from '../net/migrateLegacySaves';
import { slotPickerScreen } from '../ui/slotPicker';
import {
  CHALLENGE_CHRONICLE,
  CHALLENGE_SCORING,
  applyChallengeResult,
  buildChallengeTeamData,
  formatChallengeScoreItems,
  challengeLeaderboardPoints,
  challengeResultCopy,
  defaultChallengeProgress,
  isChallengeCelebrationMatch,
  isChallengeTrophyMatch,
  type ChallengeChapterScoreMap,
  type ChallengeChapter,
  type ChallengeProgress,
} from './challengeChronicle';
import { eraRulesForYear } from './eraRules';
import { makeCloudSlotStore } from '../net/cloudSlots';
import { showConflictModal } from '../ui/conflictModal';
import { supabase } from '../net/supabase';
import { starsSlots } from '../game/stars/store';
import type { ConflictResolver } from '../net/saveSlots';

type StarsOutcome = { score: [number, number]; winner: -1 | 0 | 1 };
type MatchRunnerCtor = typeof import('./matchRunner')['MatchRunner'];

const CHALLENGE_PROGRESS_KEY = 'challenge_chronicle_progress';
const CHRONICLE_LEADERBOARD_KEY = 'all-time';

/** What a player brings to an online match: a national team or their Stars club. */
type OnlineTeamPick =
  | { kind: 'nation'; teamIdx: number; lineup: Lineup }
  | { kind: 'custom'; team: SerializedTeam };

export class App {
  private assets!: GameAssets;
  private audio!: AudioEngine;
  private input = new InputManager();
  private ui = new UI();
  private hud = new Hud();
  private settings: Settings = loadSettings();
  private career: Career | null = null;
  private runner: MatchRunner | null = null;
  private matchRunnerCtor: MatchRunnerCtor | null = null;
  private journey: JourneyGame | null = null;
  private net: NetTransport | null = null;
  private canvas = document.getElementById('gl') as HTMLCanvasElement;
  // International Cup Stars + Seasons + online backend (offline-first)
  private stars: StarsState | null = null;
  private seasons: SeasonsState | null = null;
  private manager: ManagerState | null = null;
  private playerCareer: PlayerCareerState | null = null;
  private backend: BackendService = getBackend(null);
  private authUser: AuthUser | null = null;
  private onAuthDispose: (() => void) | null = null;
  private syncing = false;
  private adManager = createAdManager();

  async boot() {
    const progress = this.ui.loading();
    this.assets = await loadAssets(progress);
    this.audio = new AudioEngine(this.assets);
    this.audio.setVolumes(this.settings.musicVol, this.settings.sfxVol);
    // the menu "radio" music loads in the background after startup — fold it
    // into the playlist (and kick it off if the menu is waiting) once ready
    void this.assets.audioReady.then(() => this.audio.refreshMenuTracks());
    this.audio.onMusicTrack = (title) => this.ui.showNowPlaying(title);
    // Backgrounding the app (home button, app switch, screen lock) pauses the
    // match and silences all audio — and must NOT drop an online match. The
    // connection is left open: only actually closing/clearing the app tears it
    // down, and that still forfeits as before.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.audio.suspendForBackground();
        this.runner?.onAppHidden();
      } else {
        this.audio.resumeFromBackground();
      }
    });
    this.ui.onAnyClick = () => this.audio.uiClick();
    this.ui.heroUrl = this.assets.uiUrls.menuHero;
    this.ui.bgUrl = this.assets.uiUrls.teamSelect;
    // Vibrant WC26 menu backdrop pool — the general menus rotate through these at
    // random on each render. Mode-specific hubs keep their own dedicated screens.
    this.ui.menuBackdrops = [1, 2, 3, 4, 5, 6].map(
      (n) => `${import.meta.env.BASE_URL}assets/ui/menu_bg_${n}.webp`,
    );
    migrateLegacySaves();
    this.career = loadCareer();
    this.manager = loadManager();
    this.playerCareer = loadPlayerCareer();
    // Resolve any signed-in Grayson Games identity (guest by default) and keep
    // it in sync: on sign-in — including returning via a magic link — pull the
    // cloud save so a player's club follows them across devices. Never blocks
    // boot, never throws offline.
    this.onAuthDispose = onAuthChange((u) => void this.applyIdentity(u));
    void currentUser().then((u) => this.applyIdentity(u)).catch(() => {});
    this.ui.title(() => this.mainMenu());
    this.audio.playTitleMusic();
  }

  private mainMenu() {
    this.closeNet();
    this.closeJourney();
    this.audio.playMenuMusic();
    this.career = this.career ?? loadCareer();
    // restore the career's team pool (a customised cup may not match the default
    // field) so the save label resolves to the right nation
    if (this.career) this.activateCareerLeague(this.career);
    const saveLabel = this.career
      ? `${TEAMS[this.career.userTeam].short} ${this.career.mode.toUpperCase()}`
      : '';
    this.ui.mainMenu({
      hasSave: !!this.career && !this.career.finished,
      saveLabel,
      onExhibition: () => this.exhibitionFlow(),
      onManager: () => this.managerSlotsFlow(),
      onPlayer: () => this.playerSlotsFlow(),
      onCustomise: () => this.customiseFlow(),
      onChallenge: () => this.challengeFlow(),
      onStars: () => this.starsFlow(),
      onJourney: () => this.journeyFlow(),
      onOnline: () => this.onlineFlow(),
      onContinue: () => {
        if (this.career) this.activateCareerLeague(this.career);
        this.hub();
      },
      onSettings: () => this.ui.settings(this.settings, (s) => {
        this.settings = s;
        saveSettings(s);
        this.audio.setVolumes(s.musicVol, s.sfxVol);
      }, () => this.mainMenu()),
      syncLabel: this.authUser ? `SYNCED · ${this.authUser.email ?? 'account'}` : 'SIGN IN TO SYNC',
      onSync: () => this.accountFlow(),
    });
  }

  private recordAdBreak(placementId: 'challenge_result_break' | 'return_to_menu_break', reason: string): void {
    if (placementId === 'challenge_result_break') {
      this.adManager.recordOpportunity({ surface: 'break', placementId: 'challenge_result_break', reason });
      return;
    }
    this.adManager.recordOpportunity({ surface: 'break', placementId: 'return_to_menu_break', reason });
  }

  // ------------------------------------------------------------ journey

  private journeyMenuScreen(inner: string) {
    const bg = this.ui.bgUrl ?? this.ui.heroUrl;
    this.ui.root.innerHTML = `
      <div class="screen journey-menu-screen" ${bg ? `style="background-image:url('${bg}')"` : ''}>
        <div class="scrim"></div>
        <div class="journey-menu-shell">
          ${inner}
        </div>
      </div>
    `;
    this.ui.show(true);
  }

  private journeyFlow() {
    this.closeNet();
    this.closeJourney();
    this.audio.playMenuMusic();
    const stars = this.ensureStars();
    const slots = storySlots.list();
    const slotRows = slots.map((m) => `
      <button class="btn primary journey-slot" data-slot="${this.escapeHtml(m.id)}" style="text-align:left">
        CONTINUE — ${this.escapeHtml(m.name)} <span class="tmeta">${this.escapeHtml(m.summary)}</span><span class="arrow">▶</span>
      </button>`).join('');
    const cards = STORY_CAMPAIGNS.map((campaign) => {
      const unlocked = isStoryCampaignUnlocked(stars, campaign.id);
      const affordable = canAffordStoryUnlock(stars, campaign.id);
      const shortfall = storyUnlockShortfall(stars, campaign.id);
      const roleLabel = campaign.role === 'manager' ? 'MANAGER STORY' : 'PLAYER STORY';
      const unlockLabel = unlocked
        ? roleLabel
        : affordable
          ? `UNLOCK ${STORY_UNLOCK_COST.toLocaleString()} COINS`
          : `NEED ${shortfall.toLocaleString()} MORE COINS`;
      const lockedAttr = unlocked ? '' : ' data-campaign-locked="true"';
      return `
        <button class="team-card journey-campaign-card${unlocked ? '' : ' locked'}" data-campaign="${this.escapeHtml(campaign.id)}"${lockedAttr} style="text-align:left">
          <div class="tname">${this.escapeHtml(campaign.seasonLabel)} — ${this.escapeHtml(campaign.title)}</div>
          <div class="tmeta ${unlocked ? '' : 'journey-lock-price'}">${this.escapeHtml(unlockLabel)}</div>
          <div class="notice journey-campaign-copy">${this.escapeHtml(campaign.description)}</div>
          ${unlocked ? '' : `<div class="journey-lock-note">${affordable ? 'Spend coins to unlock permanently.' : 'Play Stars or top up coins to unlock.'}</div>`}
        </button>
      `;
    }).join('');
    this.journeyMenuScreen(`
      <h1 class="h-screen">STORY <span class="accent">MODE</span></h1>
      <div class="notice journey-menu-copy">${this.escapeHtml(storyModeMenuCopy())}</div>
      <div class="row spread journey-story-wallet">${coinsChipHtml(stars.coins)}</div>
      <div class="team-grid journey-campaign-grid">${cards}</div>
      <div class="menu-col journey-menu-col">
        ${slotRows}
        <button class="btn small" id="journey-back">◀ BACK</button>
      </div>
    `);
    this.ui.root.querySelectorAll<HTMLElement>('.journey-slot').forEach((b) => {
      b.addEventListener('click', () => {
        storySlots.setActive(b.dataset.slot!);
        this.runJourney();
      });
    });
    this.ui.root.querySelectorAll<HTMLElement>('[data-campaign]').forEach((button) => {
      button.addEventListener('click', () => {
        const campaignId = button.dataset.campaign as StoryCampaignId;
        const latestStars = this.ensureStars();
        if (isStoryCampaignUnlocked(latestStars, campaignId)) {
          this.journeyCreateFlow(campaignId);
          return;
        }
        if (!canAffordStoryUnlock(latestStars, campaignId)) {
          this.journeyTopUpFlow();
          return;
        }
        this.journeyUnlockFlow(campaignId);
      });
    });
    document.getElementById('journey-back')?.addEventListener('click', () => this.mainMenu());
  }

  private journeyCreateFlow(campaignId: StoryCampaignId = 'international-cup-story') {
    storySlots.setActive(null);
    const campaign = storyCampaignById(campaignId);
    let selected: 'GK' | 'DF' | 'MF' | 'FW' = campaign.defaultPosition;
    const playerForm = campaign.role === 'manager'
      ? `
        <div class="notice journey-menu-copy">You are managing Tyneside through the run-in. Squad promises, one signing and press pressure will shape the final day.</div>
      `
      : `
        <div class="panel journey-create-panel">
          <div class="journey-form-group">
            <label class="journey-form-label" for="journey-name">Player Name</label>
            <input class="txt journey-name-input" id="journey-name" maxlength="28" value="${this.escapeHtml(campaign.defaultName)}" />
          </div>
          <div class="journey-form-group">
            <div class="journey-form-label">Position</div>
            <div class="seg journey-position-row">
              ${(['GK', 'DF', 'MF', 'FW'] as const).map((pos) => (
                `<button class="${pos === selected ? 'on' : ''}" data-pos="${pos}" aria-pressed="${pos === selected ? 'true' : 'false'}">${pos}</button>`
              )).join('')}
            </div>
          </div>
        </div>
      `;
    this.journeyMenuScreen(`
      <h1 class="h-screen">${this.escapeHtml(campaign.seasonLabel)} <span class="accent">${this.escapeHtml(campaign.title)}</span></h1>
      <div class="notice journey-menu-copy">${this.escapeHtml(campaign.description)}</div>
      ${playerForm}
      <div class="menu-col journey-menu-col">
        <button class="btn primary" id="journey-start">START STORY<span class="arrow">▶</span></button>
        <button class="btn small" id="journey-back">◀ BACK</button>
      </div>
    `);
    this.ui.root.querySelectorAll<HTMLElement>('[data-pos]').forEach((button) => {
      button.addEventListener('click', () => {
        selected = button.dataset.pos as 'GK' | 'DF' | 'MF' | 'FW';
        this.ui.root.querySelectorAll<HTMLElement>('[data-pos]').forEach((b) => {
          b.classList.toggle('on', b === button);
          b.setAttribute('aria-pressed', b === button ? 'true' : 'false');
        });
      });
    });
    document.getElementById('journey-start')?.addEventListener('click', () => {
      const input = document.getElementById('journey-name') as HTMLInputElement | null;
      const name = input?.value.trim() || campaign.defaultName;
      this.runJourney({ name, position: selected, campaignId });
    });
    document.getElementById('journey-back')?.addEventListener('click', () => this.journeyFlow());
  }

  private journeyUnlockFlow(campaignId: StoryCampaignId) {
    const stars = this.ensureStars();
    const campaign = storyCampaignById(campaignId);
    this.journeyMenuScreen(`
      <h1 class="h-screen">UNLOCK <span class="accent">${this.escapeHtml(campaign.title)}</span></h1>
      <div class="notice journey-menu-copy">${this.escapeHtml(campaign.description)}</div>
      <div class="panel journey-unlock-panel">
        <div class="tname">${STORY_UNLOCK_COST.toLocaleString()} COINS</div>
        <div class="tmeta">Unlock permanently for Story Mode.</div>
      </div>
      <div class="menu-col journey-menu-col">
        <button class="btn primary" id="journey-unlock-confirm" data-campaign-unlock="${this.escapeHtml(campaignId)}">UNLOCK STORY<span class="arrow">▶</span></button>
        <button class="btn small" id="journey-back">◀ BACK</button>
      </div>
    `);
    document.getElementById('journey-unlock-confirm')?.addEventListener('click', () => {
      const result = unlockStoryCampaign(stars, campaignId);
      if (result.unlocked || result.reason === 'already-unlocked' || result.reason === 'free') {
        this.starsCommit();
        this.journeyCreateFlow(campaignId);
        return;
      }
      this.journeyTopUpFlow();
    });
    document.getElementById('journey-back')?.addEventListener('click', () => this.journeyFlow());
  }

  private journeyTopUpFlow() {
    const state = this.ensureStars();
    const commit = () => this.starsCommit();
    storeScreen(this.ui, {
      state,
      commit,
      onBack: () => this.journeyFlow(),
      authUser: this.authUser,
      onAccount: () => this.accountFlow(() => this.journeyTopUpFlow()),
    }, 'topup');
  }

  private runJourney(start?: { name: string; position: 'GK' | 'DF' | 'MF' | 'FW'; campaignId: StoryCampaignId }) {
    this.closeJourney();
    this.audio.playMenuMusic();
    const container = this.mountJourneyContainer();
    const game = new JourneyGame(container, {
      onEpisodeComplete: () => undefined,
      onStatChange: () => undefined,
      onRelationshipChange: () => undefined,
      onSceneChange: () => undefined,
      onStoryComplete: (state) => this.awardJourneyStarsCard(state),
      onMatchRequest: (request, state, onComplete) => this.playJourneyMatch(request, state, onComplete),
      onExit: () => this.mainMenu(),
    });
    this.journey = game;
    if (start) {
      const campaign = storyCampaignById(start.campaignId);
      game.startNew(start.name, start.position, campaign.clubId, start.campaignId);
    } else if (!game.continue()) {
      this.closeJourney();
      this.journeyCreateFlow();
      return;
    }
  }

  private mountJourneyContainer(): HTMLElement {
    this.ui.root.innerHTML = '<div class="journey-container"></div>';
    this.ui.show(true);
    const container = this.ui.root.querySelector('.journey-container') as HTMLElement;
    const exit = document.createElement('button');
    exit.className = 'btn small journey-exit-btn';
    exit.textContent = 'MAIN MENU';
    exit.addEventListener('click', () => this.mainMenu());
    this.ui.root.appendChild(exit);
    return container;
  }

  private playJourneyMatch(
    request: JourneyMatchRequest,
    state: JourneyState,
    onComplete: (outcome: JourneyMatchOutcome, localTeam: 0 | 1) => void,
  ) {
    const resolved = buildJourneyMatchConfig(request, state, {
      halfLengthSec: this.settings.halfLengthSec,
      difficulty: this.settings.difficulty,
      seed: (Date.now() ^ state.matchPerformance.length ^ request.matchId.length) & 0xffffff,
    });
    const finish = (outcome: JourneyMatchOutcome) => {
      if (!this.journey) return;
      const container = this.mountJourneyContainer();
      this.journey.setContainer(container);
      onComplete(outcome, resolved.localTeam);
    };
    if (resolved.usePrematch) {
      this.playMatchWithPrematch(resolved.cfg, resolved.localTeam, finish);
    } else {
      this.playMatch(resolved.cfg, resolved.localTeam, finish, undefined, true);
    }
  }

  private awardJourneyStarsCard(state: JourneyState): string {
    const stars = this.ensureStars();
    const reward = grantJourneyRewardCard(stars, state);
    this.stars = stars;
    this.starsCommit();
    return journeyRewardMessage(reward, stars.club.name);
  }

  private closeJourney() {
    if (this.journey) {
      this.journey.destroy();
      this.journey = null;
    }
  }

  private escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[ch] ?? ch));
  }

  // ------------------------------------------------------------ cup

  /** Activate the team pool a career expects: a customised cup uses its own 48,
   * everything else uses its league. */
  private activateCareerLeague(career: Career) {
    if (career.cupGroups) setCupTeams(career.cupGroups.flat());
    else setActiveLeague(career.leagueId ?? 'international-cup');
  }

  private careerSlotsFlow() {
    const open = () => slotPickerScreen(this.ui, {
      title: 'INTERNATIONAL CUP',
      slots: careerSlots.list(),
      atCap: careerSlots.atCap(),
      signedIn: !!this.authUser,
      onContinue: (id) => {
        careerSlots.setActive(id);
        this.career = careerSlots.load(id);
        if (this.career) { this.activateCareerLeague(this.career); this.hub(); }
      },
      onNew: () => this.cupFlow(),
      onRename: (id, name) => { careerSlots.rename(id, name); open(); },
      onDelete: (id) => { careerSlots.remove(id); open(); },
      onBack: () => this.mainMenu(),
    });
    open();
  }

  /** International Cup: edit the tournament, then pick your nation and kick off. */
  private cupFlow() {
    this.ui.tournamentEditor({
      allTeams: allNations(),
      initialGroups: GROUPS_BY_ID,
      defaultGroups: GROUPS_BY_ID,
      onStart: (groups) => {
        setCupTeams(groups.flat());
        const pickNation = () => {
          this.ui.teamSelect('PICK <span class="accent">YOUR NATION</span>', (teamIdx) => {
            const draft = newCareer('cup', teamIdx, Date.now() & 0xffffff, 'international-cup', groups);
            this.ui.managerName({
              teamName: TEAMS[teamIdx].name,
              defaultName: userManagerName(draft),
              onConfirm: (managerName) => {
                const cleanedManagerName = sanitizeManagerName(managerName) || userManagerName(draft);
                draft.managerName = cleanedManagerName;
                draft.leagueId = 'international-cup';
                seedTournamentInbox(draft);
                draft.pendingPress = 'pre-tournament';
                this.career = draft;
                careerSlots.create(this.career);
                saveCareer(this.career);
                this.hub();
              },
              onBack: pickNation,
            });
          }, () => this.cupFlow());
        };
        pickNation();
      },
      onBack: () => this.mainMenu(),
    });
  }

  // ------------------------------------------------------------ manager mode

  private mgrRender(inner: string, bg?: string): void {
    (this.ui as unknown as { screen: (inner: string, bg?: string) => HTMLElement }).screen(inner, bg ?? this.ui.bgUrl);
  }

  private managerSlotsFlow() {
    const open = () => slotPickerScreen(this.ui, {
      title: 'MANAGER MODE',
      slots: managerSlots.list(),
      atCap: managerSlots.atCap(),
      signedIn: !!this.authUser,
      onContinue: (id) => {
        managerSlots.setActive(id);
        this.manager = managerSlots.load(id);
        if (this.manager) this.managerHub(); else open();
      },
      onNew: () => this.managerNationSelect(),
      onRename: (id, name) => { managerSlots.rename(id, name); open(); },
      onDelete: (id) => { managerSlots.remove(id); open(); },
      onBack: () => this.mainMenu(),
    });
    open();
  }

  private managerNationSelect() {
    const nations = allNationDefs().filter((n) =>
      n.type === 'pyramid' ? (n.tiers?.some((t) => t.teamIds.length > 0) ?? false) : (n.teamPool?.length ?? 0) > 0,
    );
    const cards = nations.map((n) => {
      const teamCount = n.type === 'pyramid'
        ? (n.tiers?.reduce((s, t) => s + t.teamIds.length, 0) ?? 0)
        : (n.teamPool?.length ?? 0);
      const meta = n.type === 'pyramid'
        ? `${n.tiers?.length ?? 0} tiers · ${teamCount} clubs · promotion & relegation`
        : `${teamCount} nations · cup format`;
      return `<button class="team-card" data-nation="${n.id}" style="text-align:left">
        <div class="tname">${n.name}</div>
        <div class="tmeta">${meta}</div>
      </button>`;
    }).join('');
    this.mgrRender(`
      <h1 class="h-screen">PICK A <span class="accent">FOOTBALL WORLD</span></h1>
      <div class="menu-col">${cards || '<div class="notice">No worlds available.</div>'}</div>
      <div class="menu-col" style="margin-top:10px"><button class="btn small" id="back">◀ BACK</button></div>`);
    this.ui.root.querySelectorAll<HTMLElement>('[data-nation]').forEach((b) =>
      b.addEventListener('click', () => this.managerClubSelect(b.dataset.nation!)));
    document.getElementById('back')?.addEventListener('click', () => this.managerSlotsFlow());
  }

  private managerClubSelect(nationId: string) {
    const nation = nationById(nationId);
    if (!nation) { this.managerNationSelect(); return; }
    const allClubs = teamsOf(nation);
    const tierOf = (id: string) => nation.type === 'pyramid'
      ? (nation.tiers?.find((t) => t.teamIds.includes(id))?.tier ?? 99) : 1;
    const sorted = allClubs.slice().sort((a, b) => (tierOf(a.id) - tierOf(b.id)) || (b.strength - a.strength));
    const rows = sorted.map((t) => `<tr data-club="${t.id}" class="pick-row" style="cursor:pointer">
        <td class="num">T${tierOf(t.id)}</td><td style="text-align:left">${t.name}</td><td class="num">${t.strength}</td>
      </tr>`).join('');
    this.mgrRender(`
      <h1 class="h-screen">PICK <span class="accent">YOUR CLUB</span></h1>
      <div class="panel"><table class="tbl"><tr><th>TIER</th><th style="text-align:left">CLUB</th><th>STR</th></tr>${rows}</table></div>
      <div class="menu-col" style="margin-top:10px"><button class="btn small" id="back">◀ BACK</button></div>`);
    this.ui.root.querySelectorAll<HTMLElement>('[data-club]').forEach((b) =>
      b.addEventListener('click', () => this.managerNameAndCreate(nationId, b.dataset.club!)));
    document.getElementById('back')?.addEventListener('click', () => this.managerNationSelect());
  }

  private managerNameAndCreate(nationId: string, clubId: string) {
    const club = anyTeamById(clubId);
    this.ui.managerName({
      teamName: club?.name ?? clubId,
      defaultName: 'Manager',
      onConfirm: (name) => {
        const state = createManagerCareer({
          nationId, clubId,
          managerName: (name || '').trim() || 'Manager',
          seed: Date.now() & 0xffffff,
        });
        this.manager = state;
        managerSlots.create(state);
        saveManager(state);
        this.managerHub();
      },
      onBack: () => this.managerClubSelect(nationId),
    });
  }

  private managerHub() {
    const state = this.manager;
    if (!state) { this.managerSlotsFlow(); return; }
    if (state.phase === 'job-offers') { this.managerJobOffers(); return; }
    managerHub(this.ui, state, {
      onPlay: () => this.playManagerMatch(),
      onQuickSim: () => this.managerQuickSim(),
      onStandings: () => managerStandings(this.ui, state, () => this.managerHub()),
      onCup: () => managerCup(this.ui, state, () => this.managerHub()),
      onSquad: () => managerSquad(this.ui, state, () => this.managerHub()),
      onTraining: () => {
        const onFocus = (f: ManagerState['trainingFocus']) => {
          setTrainingFocus(state, f); saveManager(state);
          managerTraining(this.ui, state, onFocus, () => this.managerHub());
        };
        managerTraining(this.ui, state, onFocus, () => this.managerHub());
      },
      onTransfers: () => this.managerTransfersScreen(),
      onScout: () => this.managerScoutScreen(),
      onPhone: () => this.managerPhoneScreen(),
      onPress: () => this.managerPressFlow(() => this.managerHub()),
      onHeadlines: () => managerHeadlines(this.ui, state, () => this.managerHub()),
      onBoard: () => managerBoard(this.ui, state, () => this.managerHub()),
      onSeasonEnd: () => this.managerSeasonReview(),
      onSaveExit: () => { saveManager(state); this.mainMenu(); },
    });
  }

  private playManagerMatch() {
    const state = this.manager!;
    const fx = state.pendingUserFixture;
    if (!fx) { this.managerHub(); return; }
    const userIsHome = fx.homeClubId === state.userClubId;
    const homeClubId = fx.homeClubId;
    const awayClubId = fx.awayClubId;
    const userTeam = anyTeamById(state.userClubId)!;
    const squad = state.squads[state.userClubId] ?? [];
    const formation = userTeam.defaultLineup?.formation ?? '4-2-3-1';
    const initial: Lineup = userTeam.defaultLineup ?? { formation, starters: autoLineup(squad, formation) };
    this.ui.lineupSelect({
      title: 'MATCH <span class="accent">SQUAD</span>',
      team: userTeam,
      players: squad,
      initial,
      onConfirm: (lineup: Lineup) => {
        const seed = (state.seed ^ (state.matchday * 7919) ^ (state.season * 131)) >>> 0;
        const cfg = buildManagerMatch(state, {
          homeClubId, awayClubId, userIsHome, cupTie: fx.cupTie, seed,
          halfLengthSec: this.settings.halfLengthSec,
          difficulty: this.settings.difficulty,
          userFormation: lineup.formation, userStarters: lineup.starters,
        });
        const userSide = (userIsHome ? 0 : 1) as 0 | 1;
        this.playMatchWithPrematch(cfg, userSide, (outcome) => {
          const rng = new Rng((state.seed ^ (state.matchday * 40503)) >>> 0);
          recordUserResult(state, outcome.score, rng, outcome.winner);
          saveManager(state);
          const pens = fx.cupTie && outcome.score[0] === outcome.score[1];
          const note = pens ? (outcome.winner === userSide ? 'Through on penalties!' : 'Out on penalties.') : undefined;
          this.ui.result({
            teamA: anyTeamById(homeClubId)!, teamB: anyTeamById(awayClubId)!,
            score: outcome.score, note,
            continueLabel: 'BACK TO THE DUGOUT',
            onContinue: () => this.managerAdvanceAndShow(),
          });
        });
      },
      onBack: () => this.managerHub(),
    });
  }

  private managerQuickSim() {
    const state = this.manager!;
    const rng = new Rng((state.seed ^ (state.matchday * 40503)) >>> 0);
    quickSimUserFixture(state, rng);
    saveManager(state);
    this.managerAdvanceAndShow();
  }

  private managerAdvanceAndShow() {
    const state = this.manager!;
    const rng = new Rng((state.seed ^ (state.matchday * 2654435761) ^ (state.season * 131)) >>> 0);
    const res = advanceManager(state, rng);
    saveManager(state);
    if (res.seasonEnded) {
      if (state.phase === 'job-offers') this.managerJobOffers();
      else this.managerSeasonReview();
    } else {
      this.managerHub();
    }
  }

  private managerSeasonReview() {
    const state = this.manager!;
    const lines = state.lastSeasonReview?.length ? state.lastSeasonReview : ['Season complete.'];
    seasonEndSummary(this.ui, state, lines, () => {
      if (state.phase === 'job-offers') this.managerJobOffers();
      else this.managerHub();
    });
  }

  private managerJobOffers() {
    const state = this.manager!;
    let offers = jobOffers(state, new Rng((state.seed ^ (state.season * 131)) >>> 0));
    if (offers.length === 0) {
      // always offer a way back in: the weakest club in the nation that isn't the user's
      const nation = nationById(state.nationId);
      const clubs = nation ? teamsOf(nation).filter((t) => t.id !== state.userClubId) : [];
      const pick = clubs.sort((a, b) => a.strength - b.strength)[0];
      if (pick) offers = [{ clubId: pick.id, clubName: pick.name, tier: state.clubTier[pick.id] ?? 99, leagueId: state.clubLeagueId[pick.id] ?? '' }];
    }
    jobOffersScreen(this.ui, state, offers,
      (clubId) => { takeJob(state, clubId); saveManager(state); this.managerHub(); },
      () => { saveManager(state); this.mainMenu(); });
  }

  private managerTransfersScreen() {
    const state = this.manager!;
    const listings = listingsFor(state);
    const rng = () => new Rng(((state.seed ^ Date.now()) >>> 0));
    managerTransfers(this.ui, state, listings,
      (cid, idx, offer) => { const r = makeBid(state, { clubId: cid, squadIdx: idx }, offer, rng()); saveManager(state); return r; },
      (idx, asking) => { const r = offerPlayer(state, idx, asking, rng()); saveManager(state); return r; },
      () => {
        const r = signFreeAgent(state, rng()); saveManager(state);
        return { status: r.player ? 'accepted' : 'blocked', message: r.player ? `${r.player.name} signs on a free!` : 'No free agent available right now.' };
      },
      () => this.managerHub());
  }

  private managerScoutScreen() {
    const state = this.manager!;
    const nation = nationById(state.nationId);
    const clubs = (nation ? teamsOf(nation) : []).filter((t) => t.id !== state.userClubId).map((t) => ({
      clubId: t.id, name: t.name,
      tier: state.clubTier[t.id] ?? 1,
      revealed: (state.squads[t.id] ?? []).every((p) => state.scoutedPlayers[`${t.id}::${p.name}`]),
    }));
    managerScout(this.ui, state, clubs,
      (cid) => { assignScout(state, cid); saveManager(state); this.managerScoutScreen(); },
      () => this.managerHub());
  }

  private managerPhoneScreen() {
    const state = this.manager!;
    managerPhone(this.ui, state, (msgId, replyId) => {
      const msg = state.inbox.messages.find((m) => m.id === msgId);
      const reply = msg?.replies?.find((r) => r.id === replyId);
      if (msg && reply) {
        msg.read = true; msg.replied = reply.response ?? reply.text;
        if (reply.effect) applyManagerMorale(state, reply.effect);
      } else if (msg) { msg.read = true; }
      saveManager(state);
      this.managerPhoneScreen();
    }, () => this.managerHub());
  }

  private managerPressFlow(back: () => void) {
    const state = this.manager!;
    const fx = state.pendingUserFixture;
    const opp = fx ? (fx.homeClubId === state.userClubId ? fx.awayClubId : fx.homeClubId) : undefined;
    const conf = managerPressConference(state, 'pre-match', opp);
    let qi = 0;
    const ask = () => managerPress(this.ui, conf, qi, (ansId) => {
      const ans = conf.questions[qi].answers.find((a) => a.id === ansId);
      if (ans) applyManagerMorale(state, ans.effect);
      saveManager(state); qi++; ask();
    }, () => { saveManager(state); back(); }, back);
    ask();
  }

  // ------------------------------------------------------------ player career

  private playerSlotsFlow() {
    const open = () => slotPickerScreen(this.ui, {
      title: 'PLAYER CAREER',
      slots: playerSlots.list(),
      atCap: playerSlots.atCap(),
      signedIn: !!this.authUser,
      onContinue: (id) => {
        playerSlots.setActive(id);
        this.playerCareer = playerSlots.load(id);
        if (this.playerCareer) this.playerHub(); else open();
      },
      onNew: () => this.playerNationSelect(),
      onRename: (id, name) => { playerSlots.rename(id, name); open(); },
      onDelete: (id) => { playerSlots.remove(id); open(); },
      onBack: () => this.mainMenu(),
    });
    open();
  }

  private playerNationSelect() {
    const nations = allNationDefs().filter((n) =>
      n.type === 'pyramid' ? (n.tiers?.some((t) => t.teamIds.length > 0) ?? false) : (n.teamPool?.length ?? 0) > 0,
    );
    const cards = nations.map((n) => {
      const teamCount = n.type === 'pyramid'
        ? (n.tiers?.reduce((s, t) => s + t.teamIds.length, 0) ?? 0)
        : (n.teamPool?.length ?? 0);
      return `<button class="team-card" data-nation="${n.id}" style="text-align:left">
        <div class="tname">${n.name}</div>
        <div class="tmeta">${teamCount} clubs · rise from the bottom to the top</div>
      </button>`;
    }).join('');
    this.mgrRender(`
      <h1 class="h-screen">PLAYER <span class="accent">CAREER</span></h1>
      <div class="menu-col">${cards}</div>
      <div class="menu-col" style="margin-top:10px"><button class="btn small" id="back">◀ BACK</button></div>`);
    this.ui.root.querySelectorAll<HTMLElement>('[data-nation]').forEach((b) =>
      b.addEventListener('click', () => this.playerClubSelect(b.dataset.nation!)));
    document.getElementById('back')?.addEventListener('click', () => this.playerSlotsFlow());
  }

  private playerClubSelect(nationId: string) {
    const nation = nationById(nationId);
    if (!nation) { this.playerNationSelect(); return; }
    const allClubs = teamsOf(nation);
    const tierOf = (id: string) => nation.type === 'pyramid'
      ? (nation.tiers?.find((t) => t.teamIds.includes(id))?.tier ?? 99) : 1;
    // surface the smaller clubs first — a star is born at the bottom
    const sorted = allClubs.slice().sort((a, b) => (tierOf(a.id) - tierOf(b.id)) || (a.strength - b.strength));
    const rows = sorted.map((t) => `<tr data-club="${t.id}" class="pick-row" style="cursor:pointer">
        <td class="num">T${tierOf(t.id)}</td><td style="text-align:left">${t.name}</td><td class="num">${t.strength}</td>
      </tr>`).join('');
    this.mgrRender(`
      <h1 class="h-screen">PICK <span class="accent">YOUR CLUB</span></h1>
      <div class="notice">Start at a smaller club to earn your shot — work your way up.</div>
      <div class="panel"><table class="tbl"><tr><th>TIER</th><th style="text-align:left">CLUB</th><th>STR</th></tr>${rows}</table></div>
      <div class="menu-col" style="margin-top:10px"><button class="btn small" id="back">◀ BACK</button></div>`);
    this.ui.root.querySelectorAll<HTMLElement>('[data-club]').forEach((b) =>
      b.addEventListener('click', () => this.playerPositionSelect(nationId, b.dataset.club!)));
    document.getElementById('back')?.addEventListener('click', () => this.playerNationSelect());
  }

  private playerPositionSelect(nationId: string, clubId: string) {
    const positions: { v: Pos; label: string }[] = [
      { v: 'GK', label: 'GOALKEEPER' }, { v: 'DF', label: 'DEFENDER' },
      { v: 'MF', label: 'MIDFIELDER' }, { v: 'FW', label: 'STRIKER' },
    ];
    this.mgrRender(`
      <h1 class="h-screen">PICK YOUR <span class="accent">POSITION</span></h1>
      <div class="menu-col">${positions.map((p) => `<button class="btn" data-pos="${p.v}">${p.label} <span class="arrow">▶</span></button>`).join('')}</div>
      <div class="menu-col" style="margin-top:10px"><button class="btn small" id="back">◀ BACK</button></div>`);
    this.ui.root.querySelectorAll<HTMLElement>('[data-pos]').forEach((b) =>
      b.addEventListener('click', () => this.playerNameAndCreate(nationId, clubId, b.dataset.pos as Pos)));
    document.getElementById('back')?.addEventListener('click', () => this.playerClubSelect(nationId));
  }

  private async playerNameAndCreate(nationId: string, clubId: string, pos: Pos) {
    const name = await showPrompt({ title: 'NAME YOUR PLAYER', value: '', confirmLabel: 'START CAREER' });
    const finalName = (name || '').trim() || 'New Player';
    const pcs = createPlayerCareer({ nationId, clubId, playerName: finalName, pos, seed: Date.now() & 0xffffff });
    this.playerCareer = pcs;
    playerSlots.create(pcs);
    savePlayerCareer(pcs);
    this.playerHub();
  }

  private playerHub() {
    const pcs = this.playerCareer;
    if (!pcs) { this.playerSlotsFlow(); return; }
    if (pcs.phase === 'retired') { playerRetiredUi(this.ui, pcs, () => this.mainMenu()); return; }
    if (pcs.phase === 'season-end') { this.playerSeasonReviewScreen(); return; }
    playerHubUi(this.ui, pcs, {
      onPlay: () => this.playPlayerMatch(),
      onQuickSim: () => this.playerQuickSim(),
      onStats: () => playerStatsUi(this.ui, pcs, () => this.playerHub()),
      onTraining: () => {
        const onFocus = (f: PlayerTrainingFocus) => {
          setPlayerTrainingFocus(pcs, f); savePlayerCareer(pcs);
          playerTrainingUi(this.ui, pcs, onFocus, () => this.playerHub());
        };
        playerTrainingUi(this.ui, pcs, onFocus, () => this.playerHub());
      },
      onHeadlines: () => playerHeadlinesUi(this.ui, pcs, () => this.playerHub()),
      onExit: () => { savePlayerCareer(pcs); this.mainMenu(); },
    });
  }

  private playPlayerMatch() {
    const pcs = this.playerCareer!;
    const cfg = buildPlayerMatch(pcs, { halfLengthSec: this.settings.halfLengthSec, difficulty: this.settings.difficulty });
    if (!cfg) { this.playerHub(); return; }
    const fx = pcs.world.pendingUserFixture!;
    const userIsHome = fx.homeClubId === pcs.world.userClubId;
    const userSide = (userIsHome ? 0 : 1) as 0 | 1;
    const homeClubId = fx.homeClubId;
    const awayClubId = fx.awayClubId;
    this.playMatchWithPrematch(cfg, userSide, (outcome) => {
      const rng = new Rng((pcs.seed ^ (pcs.world.matchday * 40503)) >>> 0);
      recordPlayerMatch(pcs, outcome.score, rng, outcome.scorers, outcome.winner);
      savePlayerCareer(pcs);
      this.ui.result({
        teamA: anyTeamById(homeClubId)!, teamB: anyTeamById(awayClubId)!,
        score: outcome.score, continueLabel: 'CONTINUE CAREER',
        onContinue: () => this.playerAdvanceAndShow(),
      });
    });
  }

  private playerQuickSim() {
    const pcs = this.playerCareer!;
    const rng = new Rng((pcs.seed ^ (pcs.world.matchday * 40503)) >>> 0);
    quickSimPlayerFixture(pcs, rng);
    savePlayerCareer(pcs);
    this.playerAdvanceAndShow();
  }

  private playerAdvanceAndShow() {
    const pcs = this.playerCareer!;
    const rng = new Rng((pcs.seed ^ (pcs.world.matchday * 2654435761) ^ (pcs.world.season * 131)) >>> 0);
    advancePlayer(pcs, rng);
    savePlayerCareer(pcs);
    if (pcs.phase === 'retired') { playerRetiredUi(this.ui, pcs, () => this.mainMenu()); return; }
    if (pcs.phase === 'season-end') { this.playerSeasonReviewScreen(); return; }
    this.playerHub();
  }

  private playerSeasonReviewScreen() {
    const pcs = this.playerCareer!;
    const after = () => { declineTransfer(pcs); pcs.phase = 'in-season'; savePlayerCareer(pcs); this.playerHub(); };
    playerSeasonReviewUi(this.ui, pcs,
      () => { if (pcs.transferOffer) { playerMoveClub(pcs, pcs.transferOffer.clubId); savePlayerCareer(pcs); } after(); },
      () => { declineTransfer(pcs); savePlayerCareer(pcs); after(); },
      after);
  }

  // ------------------------------------------------------------ customise

  private customiseFlow() {
    customiseHub(this.ui, {
      onCreateTeam: () => this.customiseCreateTeam(),
      onCustomTeams: () => customTeamsScreen(this.ui, () => this.customiseFlow()),
      onCreateNation: () => this.customiseCreateNation(),
      onCustomNations: () => customNationsScreen(this.ui, () => this.customiseFlow()),
      onExport: () => exportScreen(this.ui, () => this.customiseFlow()),
      onImport: () => importScreen(this.ui, () => {
        showAlert({ title: 'Nation imported!', message: 'It now appears in Manager & Player Career.' });
        this.customiseFlow();
      }, () => this.customiseFlow()),
      onBack: () => this.mainMenu(),
    });
  }

  private customiseCreateTeam() {
    createTeamScreen(this.ui, () => this.customiseCreateTeam(), () => this.customiseFlow());
  }

  private customiseCreateNation() {
    void this.customiseNationName();
  }

  private async customiseNationName() {
    const name = await showPrompt({ title: 'NAME YOUR FOOTBALL WORLD', value: 'My League', confirmLabel: 'NEXT' });
    if (!name || !name.trim()) { this.customiseFlow(); return; }
    const draft: NationDraft = {
      name: name.trim(), type: 'pyramid',
      tiers: [{ name: 'Top Division', teamIds: [] }],
      promotion: 2, relegation: 2,
    };
    this.customiseNationBuilder(draft);
  }

  private customiseNationBuilder(draft: NationDraft) {
    const pool = allPickableTeams();
    const render = () => nationBuilderScreen(this.ui, draft, pool, render,
      () => this.customiseNationSave(draft),
      () => this.customiseFlow());
    render();
  }

  private customiseNationSave(draft: NationDraft) {
    const ok = saveNationFromDraft(draft);
    if (ok) {
      showAlert({ title: 'Nation saved!', message: 'Select it in Manager or Player Career to play your football world.' });
      this.customiseFlow();
    } else {
      showAlert({ title: 'Not enough teams', message: 'Add at least 2 teams to a tier before saving.' });
      this.customiseNationBuilder(draft);
    }
  }

  // ------------------------------------------------------------ exhibition

  private exhibitionFlow() {
    // Exhibition draws from every nation in the game (qualifiers and not), so
    // any team can play any team.
    setActiveLeague('all-nations');
    this.ui.teamSelect('PICK <span class="accent">HOME</span> TEAM', (a) => {
      this.ui.teamSelect('PICK <span class="accent">AWAY</span> TEAM', (b) => {
        this.ui.matchPreview(TEAMS[a], TEAMS[b], (side) => {
          const myTeam = side === 0 ? a : b;
          this.ui.lineupSelect({
            title: 'PICK <span class="accent">YOUR XI</span>',
            team: TEAMS[myTeam],
            initial: this.defaultLineup(myTeam),
            onConfirm: (lineup) => {
              const overrides: [Lineup | undefined, Lineup | undefined] = side === 0 ? [lineup, undefined] : [undefined, lineup];
              const cfg = this.buildMatch(
                a, b,
                side === 0 ? 'human' : 'ai',
                side === 1 ? 'human' : 'ai',
                false, Date.now() & 0xffffff, undefined, overrides,
              );
              this.playMatchWithPrematch(cfg, side, (outcome) => {
                this.ui.result({
                  teamA: TEAMS[a], teamB: TEAMS[b], score: outcome.score,
                  onContinue: () => this.mainMenu(),
                });
              });
            },
            onBack: () => this.exhibitionFlow(),
          });
        }, () => this.exhibitionFlow());
      }, () => this.exhibitionFlow(), a);
    }, () => this.mainMenu());
  }

  // ------------------------------------------------------------ careers

  private newCareerFlow(mode: CareerMode) {
    this.ui.leagueSelect((league) => {
      setActiveLeague(league.id);
      this.ui.teamSelect(`PICK <span class="accent">YOUR CLUB</span>`, (teamIdx) => {
        this.career = newCareer(mode, teamIdx, Date.now() & 0xffffff, league.id);
        this.career.leagueId = league.id;
        saveCareer(this.career);
        this.hub();
      }, () => this.mainMenu());
    }, () => this.mainMenu());
  }

  private hub() {
    const career = this.career!;
    if (career.finished) { this.finale(); return; }
    const isCup = career.leagueId === 'international-cup';
    const requiredReplies = isCup ? unresolvedRequiredMessages(career.inbox).length : 0;
    careerHub(this.ui, career, {
      onPlay: () => this.playCareerMatch(),
      meta: isCup ? {
        unread: career.inbox?.messages.filter((m) => !m.read).length ?? 0,
        requiredReplies,
        hasPress: !!career.pendingPress,
        concerns: career.unhappy?.length ?? 0,
        teamEvents: career.cupNarrative?.pendingTeamEvents.length ?? 0,
        headlines: career.cupNarrative?.headlines.length ?? career.news.length,
        onPhone: () => this.cupPhone(() => this.hub()),
        onPress: () => this.cupPress(career.pendingPress ?? 'speculation', undefined, () => this.hub()),
        onConcerns: () => this.cupConcerns(() => this.hub()),
        onTeam: () => this.cupTeam(() => this.hub()),
        onHeadlines: () => headlinesScreen(this.ui, career, () => this.hub()),
      } : undefined,
      onSimEvent: () => {
        advance(career);
        saveCareer(career);
        career.finished ? this.finale() : this.hub();
      },
      onTable: () => tableScreen(this.ui, career, () => this.hub()),
      onBracket: () => bracketScreen(this.ui, career, () => this.hub()),
      onSquad: () => squadScreen(this.ui, career, () => saveCareer(career), () => this.hub()),
      onTraining: () => trainingScreen(this.ui, career, () => saveCareer(career), () => this.hub()),
      onTransfers: () => transferScreen(
        this.ui, career,
        () => saveCareer(career),
        () => this.hub(),
        (teamId, name, offer) => {
          const seller = career.squads[teamId];
          if (!seller) return 'Club not found';
          const player = seller.find((p) => p.name === name);
          if (!player) return 'Player already moved on';
          const existing = career.negotiations.find((deal) => deal.teamId === teamId && deal.playerName === name);
          const rng = new Rng(career.seed ^ career.step ^ Math.round(offer));
          const result = negotiateBuyPlayer(
            career.squads,
            TEAMS[career.userTeam].id,
            { teamId, player },
            career.budget,
            offer,
            rng,
            existing?.round ?? 0,
          );
          career.negotiations = career.negotiations.filter((deal) => !(deal.teamId === teamId && deal.playerName === name));
          if (result.status === 'accepted') {
            career.budget = result.newBudget ?? career.budget;
            career.news.push(result.message);
            return null;
          }
          if (result.status === 'counter' && result.counterOffer) {
            career.negotiations.push({ teamId, playerName: name, counterOffer: result.counterOffer, round: result.round });
          }
          career.news.push(result.message);
          return result.message;
        },
        (squadIdx, asking) => {
          const rng = new Rng(career.seed ^ career.step ^ squadIdx);
          const result = negotiateSellPlayer(career.squads, TEAMS[career.userTeam].id, squadIdx, career.budget, asking, rng);
          if (result.status === 'accepted') {
            career.budget = result.newBudget ?? career.budget;
            career.news.push(result.message);
            return null;
          }
          career.news.push(result.message);
          return result.message;
        },
      ),
      onSaveExit: () => { saveCareer(career); this.mainMenu(); },
    });
  }

  private playCareerMatch() {
    const career = this.career!;
    const fx = userFixture(career);
    if (!currentEvent(career) || !fx) { this.hub(); return; }
    const isCup = career.leagueId === 'international-cup';
    const opponentName = TEAMS[fx.opponent].name;
    if (isCup) {
      const urgent = unresolvedRequiredMessages(career.inbox)[0];
      if (urgent) {
        this.cupPhone(() => this.hub(), urgent.id);
        return;
      }
      if ((career.cupNarrative?.pendingTeamEvents.length ?? 0) > 0 || (career.unhappy?.length ?? 0) > 0) {
        this.cupTeam(() => this.hub());
        return;
      }
    }
    // a pre-match press conference, then squad selection + the match
    if (isCup) this.cupPress('pre-match', opponentName, () => this.startCareerMatch());
    else this.startCareerMatch();
  }

  private startCareerMatch() {
    const career = this.career!;
    const ev = currentEvent(career);
    const fx = userFixture(career);
    if (!ev || !fx) { this.hub(); return; }
    const isCup = career.leagueId === 'international-cup';
    const cupTie = ev.kind === 'cup';
    const home = fx.home ? career.userTeam : fx.opponent;
    const away = fx.home ? fx.opponent : career.userTeam;
    const opponentName = TEAMS[fx.opponent].name;
    const seed = (career.seed ^ (career.step * 7919)) >>> 0;
    const userSide = (fx.home ? 0 : 1) as 0 | 1;
    const team = TEAMS[career.userTeam];
    const squad = career.squads[team.id];
    const unavailableSquadIndexes = squad
      .map((p, i) => (isPlayerUnavailable(career, team.id, p.name) ? i : -1))
      .filter((i) => i >= 0);
    this.ui.lineupSelect({
      title: 'MATCH <span class="accent">SQUAD</span>',
      team,
      players: squad,
      initial: this.careerLineup(career),
      unavailableSquadIndexes,
      onConfirm: (lineup) => {
        career.formation = lineup.formation;
        const safeStarters = careerStarterIndexes(career, lineup.formation, lineup.starters);
        const safeLineup = { ...lineup, starters: safeStarters };
        career.starters = safeStarters.map((i) => squad[i].name);
        saveCareer(career);
        const overrides: [Lineup | undefined, Lineup | undefined] = userSide === 0 ? [safeLineup, undefined] : [undefined, safeLineup];
        const cfg = this.buildMatch(home, away, fx.home ? 'human' : 'ai', fx.home ? 'ai' : 'human', cupTie, seed, career, overrides);
        const starters = [...career.starters];
        this.playMatchWithPrematch(cfg, userSide, (outcome) => {
          const userGoals = outcome.score[userSide];
          const oppGoals = outcome.score[1 - userSide];
          const userWon = outcome.winner === userSide;
          advance(career, [userGoals, oppGoals], userWon);
          // post-match meta: form swings, dressing-room mood, messages, jeopardy
          let postMatchRngSeed = 0;
          const postTone: PressTone = userGoals > oppGoals ? 'post-win' : userGoals < oppGoals ? 'post-loss' : 'post-draw';
          if (isCup) {
            postMatchRngSeed = (career.seed ^ (career.step * 40503)) >>> 0;
            const rng = new Rng(postMatchRngSeed);
            recordCareerMatchMomentum(career, home, away, outcome.momentum ?? [0, 0], outcome.score);
            recordUserMatchForm(career, [userGoals, oppGoals], starters, rng);
            pushResultMessages(career, [userGoals, oppGoals], opponentName, rng, fx.opponent);
          }
          saveCareer(career);
          const note = cupTie && outcome.score[0] === outcome.score[1]
            ? (userWon ? 'You win on penalties!' : 'Lost on penalties.')
            : undefined;
          this.ui.result({
            teamA: TEAMS[home], teamB: TEAMS[away], score: outcome.score, note,
            continueLabel: 'BACK TO CAMP',
            onContinue: () => {
              if (career.finished) { this.finale(); return; }
              // post-match press, then any jeopardy events, then back to camp
              if (isCup) this.cupPress(postTone, opponentName, () => {
                const rng = new Rng(postMatchRngSeed || ((career.seed ^ (career.step * 40503)) >>> 0));
                const pending = generateRoundMeta(career, postTone, rng, opponentName, [userGoals, oppGoals]);
                this.presentEvents(pending, () => this.hub());
              }, [userGoals, oppGoals]);
              else this.hub();
            },
          });
        });
      },
      onBack: () => this.hub(),
    });
  }

  // ----------------------------------------------------- cup meta overlays
  private cupPress(tone: PressTone, opponent: string | undefined, onDone: () => void, lastScore?: [number, number]) {
    const career = this.career!;
    const ctx = buildContext(career, tone, opponent, lastScore);
    const conf = buildPressConference(ctx, 'assets/journey/backgrounds/press_room_intl.webp');
    conf.speakerName = userManagerName(career);
    conf.speakerSeed = userManagerName(career);
    mountPressConference(document.body, conf, {
      onDone: (delta, result) => {
        applyMoraleDelta(career, delta);
        recordPressConferenceNarrative(career, result, tone, opponent);
        if (career.pendingPress === tone) career.pendingPress = null;
        saveCareer(career);
        onDone();
      },
    });
  }

  private cupPhone(onDone: () => void, initialMessageId?: string) {
    const career = this.career!;
    mountPhone(document.body, career.inbox!, {
      title: 'Messages', subtitle: userTeamName(career),
      initialMessageId,
      onEffect: (delta) => applyMoraleDelta(career, delta),
      onChange: () => saveCareer(career),
      onClose: () => { saveCareer(career); onDone(); },
    });
  }

  private presentEvents(events: MetaEvent[], onDone: () => void) {
    const career = this.career!;
    const next = (i: number) => {
      if (i >= events.length) { saveCareer(career); onDone(); return; }
      const event = events[i];
      mountEvent(document.body, event, {
        onResolve: (delta) => {
          applyMoraleDelta(career, delta);
          if (career.cupNarrative?.pendingTeamEvents.includes(event.id)) {
            career.cupNarrative.pendingTeamEvents = career.cupNarrative.pendingTeamEvents.filter((id) => id !== event.id);
          }
          saveCareer(career);
          next(i + 1);
        },
      });
    };
    next(0);
  }

  private cupTeam(onDone: () => void) {
    const career = this.career!;
    teamScreen(this.ui, career, () => {
      const pending = career.cupNarrative?.pendingTeamEvents.length ?? 0;
      if (pending && !(career.unhappy?.length ?? 0)) {
        const event: MetaEvent = {
          id: 'team_meeting_required',
          title: 'Team Meeting',
          senderType: 'captain',
          avatarSeed: 'captain',
          body: 'The room is waiting for clarity. The players want to know how you are steering the next match.',
          choices: [
            { id: 'unity', text: 'Bring everyone together and demand unity', outcome: 'The group leaves tighter and louder.', effect: { squad: 6, pressure: -2 } },
            { id: 'standards', text: 'Set higher standards and challenge the leaders', outcome: 'The senior players take it seriously, but the room feels the edge.', effect: { squad: 2, pressure: 2, media: 1 } },
            { id: 'calm', text: 'Keep it calm and private', outcome: 'No fireworks, but the players appreciate the control.', effect: { pressure: -3, squad: 2 } },
          ],
        };
        this.presentEvents([event], () => {
          if (career.cupNarrative) career.cupNarrative.pendingTeamEvents = [];
          saveCareer(career);
          onDone();
        });
        return;
      }
      this.cupConcerns(onDone);
    }, onDone);
  }

  private cupConcerns(onDone: () => void) {
    const career = this.career!;
    const events: MetaEvent[] = (career.unhappy ?? []).slice(0, 4).map((name) => ({
      id: `concern_${name}`, title: `${name} wants a word`, senderType: 'teammate', avatarSeed: name,
      body: `${name} isn't happy with how things are going and has come to see you. How do you handle it?`,
      choices: [
        { id: 'reassure', text: "Reassure him he's important to the cause", outcome: `${name} leaves feeling valued and motivated.`, effect: { players: [{ name, delta: 16 }], squad: 2 } },
        { id: 'honest', text: 'Be honest — he has to earn his place', outcome: `A frank chat. He respects it, even if he's not thrilled.`, effect: { players: [{ name, delta: 6 }] } },
        { id: 'firm', text: "Tell him to focus and get on with it", outcome: `${name} storms off. That could fester.`, effect: { players: [{ name, delta: -8 }], squad: -3 } },
      ],
    }));
    if (!events.length) { onDone(); return; }
    this.presentEvents(events, onDone);
  }

  private finale() {
    const career = this.career!;
    const lines = seasonSummary(career);
    clearCareer();
    this.career = null;
    this.ui.finale('SEASON <span class="accent">COMPLETE</span>', lines.length ? lines : ['What a campaign!'], () => {
      this.recordAdBreak('return_to_menu_break', 'season_complete');
      this.mainMenu();
    });
  }

  // ------------------------------------------------------------ online

  private onlineLobby(onBack: () => void = () => this.onlineFlow()) {
    // Friend matches now run on OUR signaling server (private rooms by code) +
    // TURN — no more PeerJS public broker. `onBack` is parameterised so the
    // lobby can be reached from different hubs (Online menu vs All Star Club)
    // and BACK returns to wherever the player came from.
    this.ui.onlineLobby({
      onBack,
      onHost: () => this.privateHostFlow(onBack),
      onJoin: (code) => this.privateJoinFlow(code, onBack),
    });
  }

  /** Choose CLUB (Stars XI) or NATION, then resolve a pick, before queueing. */
  private pickOnlineTeam(
    title: string,
    onPicked: (pick: OnlineTeamPick) => void,
    onBack: () => void,
  ) {
    const canUseClub = this.starsHasFullSquad();
    this.ui.onlineTeamChoice({
      title,
      canUseClub,
      clubName: canUseClub ? this.ensureStars().club.name : undefined,
      onClub: () => onPicked({ kind: 'custom', team: this.starsSerializedTeam() }),
      onNation: () => {
        setActiveLeague('all-nations');
        this.ui.teamSelect(title, (teamIdx) => {
          this.ui.lineupSelect({
            title: 'YOUR <span class="accent">XI</span>',
            team: TEAMS[teamIdx],
            initial: this.defaultLineup(teamIdx),
            onConfirm: (lineup) => onPicked({ kind: 'nation', teamIdx, lineup }),
            onBack: () => this.pickOnlineTeam(title, onPicked, onBack),
          });
        }, () => this.pickOnlineTeam(title, onPicked, onBack));
      },
      onBack,
    });
  }

  /** True when the player has a complete Stars XI to bring online. */
  private starsHasFullSquad(): boolean {
    return !this.ensureStars().squad.starters.some((id) => !id);
  }

  /** The Stars club as a wire-serializable team. */
  private starsSerializedTeam(): SerializedTeam {
    const mt = starsMatchTeam(this.ensureStars(), 'human');
    return { data: mt.data, lineup: mt.lineup, playerForm: mt.playerForm };
  }

  /** Resolve a pick into the nation-index / custom-team pieces the wire uses. */
  private pickToNet(pick: OnlineTeamPick): { teamIdx: number; lineup: Lineup; custom?: SerializedTeam } {
    return pick.kind === 'custom'
      ? { teamIdx: -1, lineup: pick.team.lineup, custom: pick.team }
      : { teamIdx: pick.teamIdx, lineup: pick.lineup };
  }

  /** Quick Match — the server pairs you with whoever else is queuing. */
  private quickMatchFlow() {
    this.pickOnlineTeam(
      'QUICK MATCH — PICK <span class="accent">YOUR</span> TEAM',
      (pick) => {
        this.ui.matchSearching('Searching for an opponent…', () => {
          this.closeNet();
          this.onlineFlow();
        });
        RtcSession.quickMatch('quick', { onStatus: (s) => this.ui.netStatus(s) })
          .then(({ session, role, seed }) => this.runOnlineMatch(session, role, seed, pick))
          .catch((e: Error) => this.onlineMatchError(e.message ?? 'Match failed'));
      },
      () => this.onlineFlow(),
    );
  }

  /** Host a private friend room; share the generated code. */
  private privateHostFlow(returnTo: () => void = () => this.onlineFlow()) {
    this.pickOnlineTeam(
      'HOST — PICK <span class="accent">YOUR</span> TEAM',
      (pick) => {
        RtcSession.privateHost({
          onCode: (code) =>
            this.ui.hostWaiting(code, () => {
              this.closeNet();
              returnTo();
            }),
          onStatus: (s) => this.ui.netStatus(s),
        })
          .then(({ session, role, seed }) => this.runOnlineMatch(session, role, seed, pick))
          .catch((e: Error) => this.onlineMatchError(`Hosting failed: ${e.message ?? e}`));
      },
      () => this.onlineLobby(returnTo),
    );
  }

  /** Join a friend's private room by code. */
  private privateJoinFlow(code: string, returnTo: () => void = () => this.onlineFlow()) {
    this.pickOnlineTeam(
      'JOIN — PICK <span class="accent">YOUR</span> TEAM',
      (pick) => {
        this.ui.matchSearching(`Joining room ${code}…`, () => {
          this.closeNet();
          returnTo();
        });
        RtcSession.privateJoin(code, { onStatus: (s) => this.ui.netStatus(s) })
          .then(({ session, role, seed }) => this.runOnlineMatch(session, role, seed, pick))
          .catch((e: Error) => this.onlineMatchError(e.message ?? 'Could not join the room'));
      },
      () => this.onlineLobby(returnTo),
    );
  }

  private onlineMatchError(msg: string) {
    this.closeNet();
    this.ui.netStatus(msg);
    setTimeout(() => this.onlineFlow(), 1900);
  }

  /** Once connected, run the cfg→ready→start handshake (role + seed come from
   *  the server) and play the host-authoritative match over the RTC channel.
   *  Either side may bring a national team or a custom Stars club. */
  private runOnlineMatch(session: RtcSession, role: Role, seed: number, myPick: OnlineTeamPick) {
    this.net = session;
    const halfLengthSec = this.settings.halfLengthSec;
    const difficulty = this.settings.difficulty;
    const mine = this.pickToNet(myPick);
    let started = false;

    const showResult = (cfg: MatchConfig, outcome: { score: [number, number]; reason?: string }) => {
      this.ui.result({
        teamA: cfg.teams[0].data,
        teamB: cfg.teams[1].data,
        score: outcome.score,
        note: outcome.reason ?? 'Online match complete',
        onContinue: () => this.onlineFlow(),
      });
      this.closeNet();
    };

    if (role === 'host') {
      const baseCfg: NetConfig = {
        leagueId: 'all-nations',
        teamA: mine.teamIdx,
        teamB: -1, // filled when the guest confirms their team
        lineups: [mine.lineup, mine.lineup],
        customA: mine.custom,
        seed: seed >>> 0,
        halfLengthSec,
        difficulty,
      };
      this.ui.netStatus('Opponent connected — waiting for their team…');
      session.send({ k: 'cfg', cfg: baseCfg });
      session.onMessage = (m: NetMsg) => {
        if (m.k !== 'ready' || started) return;
        started = true;
        const startCfg: NetConfig = {
          ...baseCfg, teamB: m.teamIdx, lineups: [mine.lineup, m.lineup], customB: m.custom,
        };
        session.send({ k: 'start', cfg: startCfg });
        const cfg = this.buildOnlineMatch(startCfg);
        this.playMatchWithPrematch(cfg, 0, (outcome) => showResult(cfg, outcome), { session, role: 'host' });
      };
    } else {
      this.ui.netStatus('Connected — waiting for kickoff…');
      session.onMessage = (m: NetMsg) => {
        if (m.k === 'cfg' && !started) {
          // we already picked our team; confirm it to the host immediately
          session.send({ k: 'ready', teamIdx: mine.teamIdx, lineup: mine.lineup, custom: mine.custom });
          this.ui.netStatus('Ready — waiting for the host…');
        } else if (m.k === 'start' && !started) {
          started = true;
          const cfg = this.buildOnlineMatch(m.cfg);
          this.playMatchWithPrematch(cfg, 1, (outcome) => showResult(cfg, outcome), { session, role: 'guest' });
        }
      };
    }

    session.onClose = () => {
      if (started) return; // in-match disconnects are handled by the match runner
      this.ui.netStatus('Opponent disconnected');
      setTimeout(() => this.onlineFlow(), 1600);
    };
  }

  private buildOnlineMatch(net: NetConfig): MatchConfig {
    // both peers must resolve nation indices against the same league
    setActiveLeague(net.leagueId ?? 'all-nations');
    const colorsA = net.customA ? net.customA.data.colors : TEAMS[net.teamA].colors;
    const colorsB = net.customB ? net.customB.data.colors : TEAMS[net.teamB].colors;
    const [kitA, kitB] = pickKits(colorsA, colorsB);
    const sanitize = (
      raw: number[], players: Parameters<typeof autoLineup>[0], formation: Lineup['formation'],
    ): { starters: number[]; fellBack: boolean } => {
      const starters = normalizeLineupForFormation(players, formation, raw);
      if (starters.length < 11) return { starters: autoLineup(players, formation), fellBack: true };
      return { starters, fellBack: false };
    };
    const mkSide = (
      side: 0 | 1, idx: number, custom: SerializedTeam | undefined, lineup: Lineup,
      controller: 'human' | 'remote', kit: KitColors,
    ): MatchTeamConfig => {
      if (custom) {
        const { starters, fellBack } = sanitize(custom.lineup.starters, custom.data.players, custom.lineup.formation);
        // distinct id per slot so two Stars clubs don't collide in the
        // appearance / kit caches (derived identically on both peers)
        const data = { ...custom.data, id: `stars-club-${side}` };
        return {
          data,
          lineup: {
            formation: custom.lineup.formation,
            starters,
            tactics: normalizeTactics(custom.lineup.tactics, custom.lineup.formation),
          },
          kit, controller,
          // a re-ordered fallback XI would mis-key squad-indexed form, so drop it
          playerForm: fellBack ? undefined : custom.playerForm,
        };
      }
      const data = TEAMS[idx];
      const { starters } = sanitize(lineup.starters, data.players, lineup.formation);
      return { data, lineup: { formation: lineup.formation, starters, tactics: normalizeTactics(lineup.tactics, lineup.formation) }, kit, controller };
    };
    const conditions = matchConditions(net.seed, undefined, false);
    return {
      teams: [
        mkSide(0, net.teamA, net.customA, net.lineups[0], 'human', kitA),
        mkSide(1, net.teamB, net.customB, net.lineups[1], 'remote', kitB),
      ],
      halfLengthSec: net.halfLengthSec,
      difficulty: net.difficulty,
      cupTie: false,
      seed: net.seed,
      weather: conditions.weather,
      timeOfDay: conditions.timeOfDay,
      temperature: conditions.temperature,
      isFriendly: true,
      leagueId: net.leagueId,
    };
  }

  private closeNet() {
    if (this.net) { this.net.close(); this.net = null; }
  }

  // ------------------------------------------------------------ online hub / stars / seasons

  private onlineFlow() {
    this.closeNet();
    onlineMenu(this.ui, {
      signedIn: !!this.authUser,
      userLabel: this.authUser?.email,
      onSeasons: () => this.seasonsFlow(),
      onQuickMatch: () => this.quickMatchFlow(),
      onFriend: () => this.onlineLobby(),
      onAccount: () => this.accountFlow(),
      onBack: () => this.mainMenu(),
    });
  }

  private accountFlow(onBack: () => void = () => this.onlineFlow()) {
    accountScreen(this.ui, {
      user: this.authUser,
      onSignIn: (email) => signInWithEmail(email),
      onSignOut: () => {
        void signOut().then(() => {
          this.authUser = null;
          this.backend = getBackend(null);
          this.accountFlow(onBack);
        });
      },
      onGuest: onBack,
      onBack,
    });
  }

  /** React to a sign-in / sign-out: swap the backend, attach/detach cloud
   * stores on all slot singletons, and sync any remote saves. Best-effort —
   * never throws. */
  private async applyIdentity(user: AuthUser | null): Promise<void> {
    this.authUser = user;
    this.backend = getBackend(user?.id ?? null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allSlots: any[] = [careerSlots, storySlots, seasonsSlots, starsSlots, managerSlots, playerSlots];
    if (!user || !supabase) {
      for (const s of allSlots) s.setCloud(null);
      return;
    }
    const resolver: ConflictResolver = (i) => showConflictModal(i);
    for (const s of allSlots) {
      s.setCloud(makeCloudSlotStore(user.id, supabase as never));
    }
    if (this.syncing) return;
    this.syncing = true;
    try {
      await Promise.all(allSlots.map((s) => s.sync(resolver)));
    } catch (e) {
      console.warn('cloud sync failed', e);
    } finally {
      this.syncing = false;
    }
    // refresh in-memory caches that may have changed after sync
    this.stars = starsSlots.load('main') ?? this.stars;
    this.career = careerSlots.load() ?? this.career;
    this.manager = managerSlots.load() ?? this.manager;
    this.playerCareer = playerSlots.load() ?? this.playerCareer;
    this.seasons = seasonsSlots.load() ?? this.seasons;
  }

  /** Persist the Stars club locally and best-effort to the cloud. */
  private starsCommit() {
    if (!this.stars) return;
    saveStars(this.stars);
  }

  /** Load (or create) the Stars club and apply the weekly rollover + free grant. */
  private ensureStars(): StarsState {
    if (!this.stars) this.stars = loadStars() ?? newStars();
    const s = this.stars;
    const now = Date.now();
    const wk = weekKeyFor(now);
    let changed = false;
    if (s.challenge.weekKey !== wk) { resetIfNewWeek(s, now); changed = true; }
    if (ensureArcadeTokenGrants(s.arcadeTokens, now)) changed = true;
    if (s.weekly.lastGrantWeek !== wk) {
      // Weekly reward: a free pack's worth of coins (open packs in the store).
      s.coins += packById(WEEKLY_FREE_PACK)?.price ?? 3000;
      s.weekly.lastGrantWeek = wk;
      changed = true;
    }
    if (changed) this.starsCommit();
    return s;
  }

  private starsMatch = (opp: Opponent, onResult: (o: StarsOutcome) => void) => {
    if (!this.stars) return;
    // Safety net: never launch (and never let starsMatchTeam throw) on an
    // incomplete XI. The play/cup screens also guard, but this covers every path.
    if (this.stars.squad.starters.some((id) => !id)) return;
    const home = starsMatchTeam(this.stars, 'human');
    const away: MatchTeamConfig = { data: opp.team, lineup: opp.lineup, kit: opp.kit, controller: 'ai' };
    const cfg: MatchConfig = {
      teams: [home, away],
      halfLengthSec: this.settings.halfLengthSec,
      difficulty: this.settings.difficulty,
      cupTie: false,
      seed: (Date.now() & 0xffffff) >>> 0,
      isFriendly: true,
    };
    this.playMatchWithPrematch(cfg, 0, (outcome) => onResult(outcome));
  };

  private starsFlow() {
    const state = this.ensureStars();
    const commit = () => this.starsCommit();
    const back = () => this.starsFlow();
    // publish the current XI so other players can face it in Squad Battles
    // (best-effort; no-ops for guests / an incomplete squad)
    void publishMySquad(state, this.authUser?.id ?? null);
    starsHub(this.ui, {
      state,
      onSquad: () => squadBuilder(this.ui, { state, commit, onBack: back }),
      onStore: () => storeScreen(this.ui, {
        state,
        commit,
        onBack: back,
        authUser: this.authUser,
        onAccount: () => this.accountFlow(() => this.starsFlow()),
      }),
      onTrade: () => tradeScreen(this.ui, { state, commit, onBack: back }),
      onOnlineRivals: () => void this.openStarsRivals(state, commit, back),
      onWorldTour: () => this.openStarsWorldTour(state, commit, back),
      onPlayFriend: () => this.onlineLobby(() => this.starsFlow()),
      onLeaderboard: () => leaderboardScreen(this.ui, {
        board: 'rivals',
        boards: ['rivals', 'challenge', 'cup'],
        title: 'ALL STAR LEADERBOARD',
        subtitle: 'Weekly club performance',
        myUserId: this.authUser?.id ?? null,
        weekKey: weekKeyFor(Date.now()),
        onBack: back,
      }),
      onClub: () => this.openClub(state, back),
      onBack: () => this.mainMenu(),
    });
  }

  /** My Club: edit the club name + kit. Name and kit changes each cost coins. */
  private openClub(state: StarsState, back: () => void): void {
    const draw = () => clubScreen(this.ui, {
      state,
      onRename: async (name) => {
        const trimmed = name.trim();
        if (!trimmed || trimmed === state.club.name) { draw(); return; }
        if (state.coins < CLUB_RENAME_COST) {
          await showAlert({ title: 'NOT ENOUGH COINS', message: `Renaming the club costs ${CLUB_RENAME_COST.toLocaleString()} coins.` });
          draw();
          return;
        }
        const ok = await showConfirm({
          title: 'RENAME CLUB?',
          message: `Set the name to "${trimmed}" for ${CLUB_RENAME_COST.toLocaleString()} coins?`,
          confirmLabel: 'RENAME',
        });
        if (!ok) { draw(); return; }
        addCoins(state, -CLUB_RENAME_COST);
        setClub(state, { ...state.club, name: trimmed });
        this.starsCommit();
        draw();
      },
      onRandomKit: async () => {
        if (state.coins < CLUB_KIT_COST) {
          await showAlert({ title: 'NOT ENOUGH COINS', message: `Randomising the kit costs ${CLUB_KIT_COST.toLocaleString()} coins.` });
          return;
        }
        const ok = await showConfirm({
          title: 'RANDOMISE KIT?',
          message: `Roll new kit colours for ${CLUB_KIT_COST.toLocaleString()} coins?`,
          confirmLabel: 'RANDOMISE',
        });
        if (!ok) return;
        addCoins(state, -CLUB_KIT_COST);
        setClub(state, { ...state.club, kit: randomKit() });
        this.starsCommit();
        draw();
      },
      onBack: back,
    });
    draw();
  }

  /** Open Online Rivals, first fetching other players' real squads. */
  private async openStarsRivals(state: StarsState, commit: () => void, back: () => void): Promise<void> {
    const realOpponents = await fetchRealOpponents(this.authUser?.id ?? null, squadRating(state), 3);
    const submitScore = (board: 'rivals' | 'challenge' | 'cup', points: number, weekKey: string): void => {
      void this.backend.submitScore?.(board, points, weekKey);
    };
    playScreen(this.ui, {
      state, commit, onBack: back, play: this.starsMatch,
      onCupStars: () => cupStarsScreen(this.ui, { state, commit, onBack: back, play: this.starsMatch, submitScore }),
      realOpponents,
      onLeaderboard: () => leaderboardScreen(this.ui, {
        board: 'rivals',
        boards: ['rivals', 'challenge', 'cup'],
        title: 'ONLINE RIVALS LEADERBOARD',
        myUserId: this.authUser?.id ?? null,
        weekKey: weekKeyFor(Date.now()),
        onBack: () => void this.openStarsRivals(state, commit, back),
      }),
      submitScore,
    });
  }

  private openStarsWorldTour(state: StarsState, commit: () => void, back: () => void): void {
    const now = Date.now();
    const weekKey = weekKeyFor(now);
    resetIfNewWeek(state, now);
    commit();
    worldTourScreen(this.ui, {
      state,
      weekKey,
      onPlayStage: (stageIndex) => {
        const stage = WORLD_TOUR_STAGES[stageIndex];
        const opponent = worldTourOpponents(state, weekKey)[stageIndex];
        if (!stage || !opponent || state.squad.starters.some((id) => !id)) return;
        const home = starsMatchTeam(state, 'human');
        const away: MatchTeamConfig = { data: opponent.team, lineup: opponent.lineup, kit: opponent.kit, controller: 'ai' };
        const cfg: MatchConfig = {
          teams: [home, away],
          halfLengthSec: this.settings.halfLengthSec,
          difficulty: this.settings.difficulty,
          cupTie: false,
          seed: (Date.now() & 0xffffff) >>> 0,
          isFriendly: true,
        };
        applyWorldTourHandicap(cfg, stage);
        this.playMatchWithPrematch(cfg, 0, (outcome) => {
          const result = recordWorldTourResult(state, outcome, weekKey);
          if (result.rewardCoins) addCoins(state, result.rewardCoins);
          commit();
          showReward(this.ui, {
            title: result.completed ? 'WORLD TOUR COMPLETE' : result.advanced ? 'STAGE CLEARED' : 'TRY AGAIN',
            coins: result.rewardCoins,
            lines: result.lines,
            onDone: () => this.openStarsWorldTour(state, commit, back),
          });
        });
      },
      onBack: back,
    });
  }

  private seasonsFlow() {
    const open = () => slotPickerScreen(this.ui, {
      title: 'SEASONS',
      slots: seasonsSlots.list(),
      atCap: seasonsSlots.atCap(),
      signedIn: !!this.authUser,
      onContinue: (id) => {
        seasonsSlots.setActive(id);
        this.seasons = seasonsSlots.load(id);
        this.seasonsPlay();
      },
      onNew: () => this.seasonsPlay(true),
      onRename: (id, name) => { seasonsSlots.rename(id, name); open(); },
      onDelete: (id) => { seasonsSlots.remove(id); open(); },
      onBack: () => this.onlineFlow(),
    });
    open();
  }

  private seasonsPlay(forceNew = false) {
    if (forceNew) this.seasons = null;
    this.seasons = this.seasons ?? loadSeasons();
    const play = (oppIdx: number, onResult: (o: StarsOutcome) => void) => {
      if (!this.seasons) return;
      setActiveLeague('all-nations');
      const cfg = this.buildMatch(this.seasons.teamIdx, oppIdx, 'human', 'ai', false, (Date.now() & 0xffffff) >>> 0);
      cfg.halfLengthSec = this.settings.halfLengthSec;
      cfg.difficulty = this.settings.difficulty;
      this.playMatchWithPrematch(cfg, 0, (outcome) => onResult(outcome));
    };
    seasonsScreen(this.ui, {
      state: this.seasons,
      onPickTeam: (teamIdx) => {
        this.seasons = newSeasons(teamIdx);
        seasonsSlots.create(this.seasons);
        saveSeasons(this.seasons);
        this.seasonsPlay();
      },
      commit: () => { if (this.seasons) saveSeasons(this.seasons); },
      onBack: () => this.onlineFlow(),
      play,
    });
  }

  // ------------------------------------------------------------ plumbing

  private defaultLineup(teamIdx: number): Lineup {
    return teamDefaultLineup(TEAMS[teamIdx]);
  }

  private careerLineup(career: Career): Lineup {
    const starters = careerStarterIndexes(career, career.formation);
    return { formation: career.formation, starters, tactics: normalizeTactics(undefined, career.formation) };
  }

  private buildMatch(
    homeIdx: number, awayIdx: number,
    homeCtl: 'human' | 'ai' | 'remote', awayCtl: 'human' | 'ai' | 'remote',
    cupTie: boolean, seed: number, career?: Career,
    lineupOverrides?: [Lineup | undefined, Lineup | undefined],
  ): MatchConfig {
    const mk = (idx: number, controller: 'human' | 'ai' | 'remote', kit: KitColors, side: 0 | 1): MatchTeamConfig => {
      const data = TEAMS[idx];
      const squad = career ? career.squads[data.id] : data.players;
      const liveData = { ...data, players: squad };
      const isUser = career && idx === career.userTeam;
      const override = lineupOverrides?.[side];
      const defaultLineup = teamDefaultLineup({ ...data, players: squad });
      const formation = override?.formation ?? (isUser ? career.formation : defaultLineup.formation);
      let starters: number[];
      if (override) {
        starters = isUser
          ? careerStarterIndexes(career, formation, override.starters)
          : normalizeLineupForFormation(squad, formation, override.starters);
        if (starters.length < 11) starters = autoLineup(squad, formation);
      } else if (isUser) {
        starters = careerStarterIndexes(career, formation);
      } else {
        starters = defaultLineup.starters;
      }
      const tactics = normalizeTactics(override?.tactics ?? (!override && !isUser ? defaultLineup.tactics : undefined), formation);
      // the user's squad carries live form into the match; AI nations stay neutral
      const playerForm = isUser ? userStarterForm(career!) : undefined;
      return { data: liveData, lineup: { formation, starters, tactics }, kit, controller, playerForm };
    };
    const [homeKit, awayKit] = pickKits(TEAMS[homeIdx].colors, TEAMS[awayIdx].colors);
    const leagueRound = career && currentEvent(career)?.kind === 'league'
      ? (currentEvent(career) as { kind: 'league'; round: number }).round
      : undefined;
    const leagueId = career?.leagueId;
    const isWorldCup = leagueId === 'international-cup';
    const conditions = matchConditions(seed, leagueRound, isWorldCup);
    const isFriendly = !career;
    // World Cup ties are played at one of the 16 real 2026 host venues, picked at
    // random per fixture (deterministic from the seed) rather than a club ground
    const stadiumName = isWorldCup
      ? WORLD_CUP_VENUES[Math.floor(new Rng((seed ^ 0x57ad1) >>> 0).next() * WORLD_CUP_VENUES.length)]?.name
      : undefined;
    const initialMomentum: [number, number] | undefined = career && isWorldCup
      ? [careerMomentumForTeam(career, homeIdx), careerMomentumForTeam(career, awayIdx)]
      : undefined;
    let cupRoundName: string | undefined = undefined;
    let homePosition: number | undefined = undefined;
    let awayPosition: number | undefined = undefined;

    if (career) {
      const ev = currentEvent(career);
      if (ev) {
        if (ev.kind === 'cup') {
          cupRoundName = career.cupRounds[ev.round]?.name;
        } else if (ev.kind === 'league') {
          const table = leagueTable(career);
          homePosition = table.findIndex((r: { team: number }) => r.team === homeIdx) + 1;
          awayPosition = table.findIndex((r: { team: number }) => r.team === awayIdx) + 1;
        }
      }
    }

    return {
      teams: [mk(homeIdx, homeCtl, homeKit, 0), mk(awayIdx, awayCtl, awayKit, 1)],
      halfLengthSec: this.settings.halfLengthSec,
      difficulty: this.settings.difficulty,
      cupTie,
      trophyWin: cupRoundName === 'Final', // winning the cup final → trophy celebration
      seed,
      weather: conditions.weather,
      timeOfDay: conditions.timeOfDay,
      temperature: conditions.temperature,
      isFriendly,
      leagueId,
      cupRoundName,
      stadiumName,
      homePosition,
      awayPosition,
      initialMomentum,
    };
  }

  private async loadMatchRunner(): Promise<MatchRunnerCtor> {
    if (!this.matchRunnerCtor) {
      this.matchRunnerCtor = (await import('./matchRunner')).MatchRunner;
    }
    return this.matchRunnerCtor;
  }

  private async playMatch(
    cfg: MatchConfig,
    localTeam: 0 | 1,
    onEnd: (outcome: { score: [number, number]; winner: -1 | 0 | 1; momentum?: [number, number]; reason?: string; scorers?: { team: 0 | 1; player: string; minute: number; ownGoal?: boolean }[] }) => void,
    net?: { session: NetTransport; role: 'host' | 'guest' },
    skipIntro = false,
  ) {
    const MatchRunnerImpl = await this.loadMatchRunner();
    const adBoardCreatives = this.pitchBoardCreatives(cfg.teams[0].data.name, cfg.isFriendly ? 'friendly' : 'match');
    this.ui.show(false);
    this.runner = new MatchRunnerImpl({
      cfg,
      kits: [cfg.teams[0].kit, cfg.teams[1].kit],
      assets: this.assets,
      input: this.input,
      audio: this.audio,
      hud: this.hud,
      canvas: this.canvas,
      net,
      adBoardCreatives,
      localTeam,
      skipIntro,
      onEnd: (outcome) => {
        this.runner = null;
        this.audio.playMenuMusic();
        onEnd(outcome);
      },
      onAbort: () => {
        this.runner = null;
        this.closeNet();
        this.mainMenu();
      },
      onPauseMenu: (view) => this.ui.pauseMenu(view),
      onPauseStatus: (status) => this.ui.updatePauseStatus(status),
      onSubstitutionMenu: (menu) => this.ui.substitutionMenu(menu),
      onAdOpportunity: (opportunity) => this.adManager.recordOpportunity(opportunity),
      hidePauseMenu: () => this.ui.show(false),
    });
    this.runner.start();
  }

  private pitchBoardCreatives(homeName: string, mode: string): PitchBoardCreative[] {
    return this.adManager.getPlacements({
      surface: 'world_board',
      placementId: 'pitch_boards',
      homeName,
      mode,
    }).map((creative: AdCreative) => ({
      text: creative.text,
      background: creative.background,
      foreground: creative.foreground,
      imageUrl: creative.imageUrl,
    }));
  }

  private playMatchWithPrematch(
    cfg: MatchConfig,
    localTeam: 0 | 1,
    onEnd: (outcome: { score: [number, number]; winner: -1 | 0 | 1; momentum?: [number, number]; reason?: string; scorers?: { team: 0 | 1; player: string; minute: number; ownGoal?: boolean }[] }) => void,
    net?: { session: NetTransport; role: 'host' | 'guest' },
  ) {
    const bgUrl = this.assets.uiUrls.prematchStadium ?? this.assets.uiUrls.teamSelect;
    const runPrematch = () => {
      const commentary = new CommentaryEngine(this.assets);
      let raf = 0;
      let started = false;
      let begin = () => {};
      const pumpCrowd = () => {
        if (started) return;
        this.audio.updateCrowd(0.48, 1 / 60);
        raf = window.requestAnimationFrame(pumpCrowd);
      };
      begin = () => {
        if (started) return;
        started = true;
        window.cancelAnimationFrame(raf);
        commentary.stop();
        this.audio.stopCrowd();
        // skipIntro=false: after the 2D line-up board, run the 3D tunnel WALK-OUT
        // (both teams file out and fan to their kick-off shape) before kick-off.
        window.requestAnimationFrame(() => this.playMatch(cfg, localTeam, onEnd, net, false));
      };

      this.ui.prematchLineups({ cfg, bgUrl, onSkip: begin });
      this.audio.stopMenuMusic();
      this.audio.startCrowd();
      raf = window.requestAnimationFrame(pumpCrowd);
      window.requestAnimationFrame(() => {
        if (started) return;
        commentary.startPrematchPreview(cfg);
        // hold the line-ups on screen a beat longer so they can be read — advance
        // only once BOTH the commentary preview has finished AND a minimum dwell has
        // elapsed (the user can always SKIP earlier). The commentary wait is CAPPED:
        // a stalled clip fetch (a network blip) must never leave waitUntilIdle()
        // unresolved and strand the player on the line-up screen with the match
        // never starting — bound it so begin() always fires within ~12s.
        const minDwell = new Promise<void>((resolve) => window.setTimeout(resolve, 6500));
        void Promise.all([commentary.waitUntilIdle(12000), minDwell]).then(begin);
      });
    };

    // A platform-aware controls screen precedes the match — it shows for a couple
    // of seconds like a loading card, then moves on by itself (or sooner if the
    // player taps CONTINUE) to the line-up reveal and kick-off. Online ties skip it
    // so the synchronised kick-off isn't held up by one player reading the controls.
    if (net) { runPrematch(); return; }
    let advanced = false;
    let autoTimer = 0;
    const advance = () => {
      if (advanced) return;
      advanced = true;
      window.clearTimeout(autoTimer);
      runPrematch();
    };
    this.ui.controlsScreen({ bgUrl, onContinue: advance });
    autoTimer = window.setTimeout(advance, 3000);
  }

  private challengeFlow() {
    setActiveLeague('all-nations');
    const stars = this.ensureStars();
    const progress = this.loadChallengeProgress();
    let challengeLaunchLocked = false;
    this.ui.challengeChronicle({
      chapters: CHALLENGE_CHRONICLE,
      currentIndex: progress.currentIndex,
      completedIds: progress.completedIds,
      completedCount: progress.completedIds.length,
      arcadeTokens: stars.arcadeTokens.balance,
      runActive: progress.runActive,
      leaderboardPoints: challengeLeaderboardPoints(
        progress.completedIds.length,
        CHALLENGE_CHRONICLE.length,
        progress.finalMargin,
        progress.chapterScores,
      ),
    }, {
      onPlayChapter: (chapterId) => {
        if (challengeLaunchLocked) return;
        const latestProgress = this.loadChallengeProgress();
        const index = CHALLENGE_CHRONICLE.findIndex((entry) => entry.id === chapterId);
        if (index < 0) return;
        const completedReplay = latestProgress.completedIds.includes(chapterId);
        const allowed = index <= latestProgress.currentIndex || completedReplay;
        if (!allowed) return;
        if (!latestProgress.runActive && !completedReplay) {
          if (!canSpendArcadeToken(stars.arcadeTokens)) {
            this.challengeFlow();
            return;
          }
          spendArcadeToken(stars.arcadeTokens);
          this.saveChallengeProgress({ ...latestProgress, runActive: true });
          this.starsCommit();
        }
        challengeLaunchLocked = true;
        this.playChallengeChapter(CHALLENGE_CHRONICLE[index]);
      },
      onLeaderboard: () => leaderboardScreen(this.ui, {
        board: 'chronicle',
        boards: ['chronicle'],
        title: 'CHALLENGE LEADERBOARD',
        subtitle: 'All-time · arcade score',
        myUserId: this.authUser?.id ?? null,
        weekKey: CHRONICLE_LEADERBOARD_KEY,
        onBack: () => this.challengeFlow(),
      }),
      onTopUp: () => this.challengeTopUpFlow(),
      onBack: () => this.mainMenu(),
    });
  }

  private challengeTopUpFlow() {
    const state = this.ensureStars();
    const commit = () => this.starsCommit();
    storeScreen(this.ui, {
      state,
      commit,
      onBack: () => this.challengeFlow(),
      authUser: this.authUser,
      onAccount: () => this.accountFlow(() => this.challengeTopUpFlow()),
    }, 'topup');
  }

  private loadChallengeProgress(): ChallengeProgress {
    const raw = localStorage.getItem(CHALLENGE_PROGRESS_KEY);
    if (!raw) return defaultChallengeProgress();
    try {
      const parsed = JSON.parse(raw) as Partial<ChallengeProgress>;
      const completedIds = Array.isArray(parsed.completedIds)
        ? parsed.completedIds.filter((id): id is ChallengeProgress['completedIds'][number] => CHALLENGE_CHRONICLE.some((chapter) => chapter.id === id))
        : [];
      const rawScores = parsed.chapterScores && typeof parsed.chapterScores === 'object'
        ? parsed.chapterScores as Record<string, unknown>
        : {};
      const chapterScores = completedIds.reduce<ChallengeChapterScoreMap>((scores, id) => {
        const rawEntry = rawScores[id];
        const bestPoints = rawEntry && typeof rawEntry === 'object' && 'bestPoints' in rawEntry
          ? Number((rawEntry as { bestPoints?: unknown }).bestPoints)
          : NaN;
        scores[id] = {
          bestPoints: Number.isFinite(bestPoints) && bestPoints > 0
            ? Math.floor(bestPoints)
            : CHALLENGE_SCORING.clear,
        };
        return scores;
      }, {});
      const currentIndex = Math.max(0, Math.min(
        typeof parsed.currentIndex === 'number' ? parsed.currentIndex : completedIds.length,
        CHALLENGE_CHRONICLE.length - 1,
      ));
      const finalMargin = typeof parsed.finalMargin === 'number' ? Math.max(0, parsed.finalMargin) : null;
      const runActive = parsed.runActive === true;
      return { currentIndex, completedIds, finalMargin, chapterScores, runActive };
    } catch {
      return defaultChallengeProgress();
    }
  }

  private saveChallengeProgress(progress: ChallengeProgress): void {
    localStorage.setItem(CHALLENGE_PROGRESS_KEY, JSON.stringify(progress));
  }

  private playChallengeChapter(chapter: ChallengeChapter): void {
    const cfg = this.buildChallengeMatch(chapter);
    this.playMatchWithPrematch(cfg, chapter.playerTeam, (outcome) => {
      const applied = applyChallengeResult(this.loadChallengeProgress(), chapter.id, outcome.score);
      this.saveChallengeProgress(applied.progress);
      if (applied.verdict.success) {
        void this.backend.submitScore?.('chronicle', applied.leaderboardPoints, CHRONICLE_LEADERBOARD_KEY);
      }
      const copy = challengeResultCopy(applied.verdict.success, chapter.id === CHALLENGE_CHRONICLE.at(-1)?.id);
      const scoreLine = applied.scoreBreakdown.total > 0
        ? ` +${applied.scoreBreakdown.total.toLocaleString()} PTS${applied.scoreImproved ? ' - NEW BEST' : ''}: ${formatChallengeScoreItems(applied.scoreBreakdown.items)}.`
        : '';
      this.ui.result({
        teamA: cfg.teams[0].data,
        teamB: cfg.teams[1].data,
        score: outcome.score,
        note: `${copy.headline} - ${applied.verdict.message}${scoreLine} ${applied.verdict.success ? chapter.resultSuccess : chapter.resultFailure}`,
        continueLabel: copy.continueLabel,
        onContinue: () => {
          this.recordAdBreak('challenge_result_break', applied.verdict.success ? 'challenge_success' : 'challenge_failure');
          this.challengeFlow();
        },
      });
    });
  }

  private buildChallengeMatch(chapter: ChallengeChapter): MatchConfig {
    const homeBase = TEAMS.find((team) => team.id === chapter.home.baseTeamId);
    const awayBase = TEAMS.find((team) => team.id === chapter.away.baseTeamId);
    if (!homeBase || !awayBase) throw new Error(`Challenge teams not found: ${chapter.home.baseTeamId} vs ${chapter.away.baseTeamId}`);
    const home = buildChallengeTeamData(homeBase, chapter.home);
    const away = buildChallengeTeamData(awayBase, chapter.away);
    const [homeKit, awayKit] = pickKits(home.colors, away.colors);
    const seed = (Date.now() ^ chapter.year ^ chapter.id.length) & 0xffffff;
    const conditions = matchConditions(seed, undefined, true);
    return {
      teams: [
        {
          data: home,
          lineup: {
            formation: chapter.home.formation,
            starters: autoLineup(home.players, chapter.home.formation),
            tactics: normalizeTactics(undefined, chapter.home.formation),
          },
          kit: homeKit,
          controller: chapter.playerTeam === 0 ? 'human' : 'ai',
        },
        {
          data: away,
          lineup: {
            formation: chapter.away.formation,
            starters: autoLineup(away.players, chapter.away.formation),
            tactics: normalizeTactics(undefined, chapter.away.formation),
          },
          kit: awayKit,
          controller: chapter.playerTeam === 1 ? 'human' : 'ai',
        },
      ],
      halfLengthSec: this.settings.halfLengthSec,
      difficulty: chapter.difficulty,
      cupTie: false,
      trophyWin: isChallengeTrophyMatch(chapter),
      celebrationWin: isChallengeCelebrationMatch(chapter),
      celebrationTeam: chapter.playerTeam,
      seed,
      isFriendly: true,
      weather: conditions.weather,
      timeOfDay: conditions.timeOfDay,
      temperature: conditions.temperature,
      stadiumName: `${chapter.year} Chronicle Ground`,
      cupRoundName: chapter.title,
      startScore: chapter.startScore,
      startTimeSec: chapter.startTimeSec,
      startHalf: chapter.startHalf,
      era: eraRulesForYear(chapter.year),
    };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** pick the matchday conditions from the seed; winter league rounds skew wintry.
 *  A summer tournament (the International Cup / World Cup, played June–July across the
 *  USA, Mexico and Canada) never gets snow or ice — just clear, sunny or rainy. */
function matchConditions(seed: number, leagueRound?: number, summerCup = false): { weather: MatchWeather; timeOfDay: MatchTimeOfDay; temperature: number } {
  const rng = new Rng((seed ^ 0xc0ffee) >>> 0);
  const t = rng.next();
  const timeOfDay: MatchTimeOfDay = t < 0.42 ? 'day' : t < 0.7 ? 'evening' : 'night';
  // a 42-round season runs Aug-May; rounds ~12-28 are the depths of winter
  const winter = !summerCup && leagueRound !== undefined && leagueRound >= 12 && leagueRound <= 28;
  const w = rng.next();
  const weather: MatchWeather = summerCup
    // World Cup: clear / sunny / rain only — no snow or ice
    ? (w < 0.5 ? 'normal' : w < 0.78 ? 'sunny' : 'rain')
    : winter
      ? (w < 0.3 ? 'normal' : w < 0.42 ? 'sunny' : w < 0.68 ? 'rain' : w < 0.9 ? 'snow' : 'ice')
      : (w < 0.5 ? 'normal' : w < 0.76 ? 'sunny' : w < 0.95 ? 'rain' : 'snow');
  return { weather, timeOfDay, temperature: deriveTemperature(weather, timeOfDay, rng.next(), summerCup, winter) };
}

/** Hidden pitch temperature (°C), coherent with the visible conditions: warmer by
 * day and in sun, colder at night and in rain/snow/ice. Summer-cup ties run hot
 * (so they hit the drinks-break threshold); deep-winter league games run cold. */
function deriveTemperature(weather: MatchWeather, timeOfDay: MatchTimeOfDay, roll: number, summerCup: boolean, winter: boolean): number {
  const byTime = timeOfDay === 'day' ? 24 : timeOfDay === 'evening' ? 18 : 14;
  const byWeather = weather === 'sunny' ? 6 : weather === 'rain' ? -4 : weather === 'snow' ? -16 : weather === 'ice' ? -20 : 0;
  const season = summerCup ? 7 : winter ? -6 : 0;
  const jitter = (roll - 0.5) * 8; // ±4
  return Math.round(Math.max(2, Math.min(40, byTime + byWeather + season + jitter)));
}
