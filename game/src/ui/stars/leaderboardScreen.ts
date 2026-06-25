// Weekly LEADERBOARD — the top scorers for the current week, split by board
// (Challenge / Cup). Renders instantly with a placeholder, then best-effort
// fills the table from weekly_points. Always safe offline.
import type { UI } from '../screens';
import { bind } from '../screens';
import { supabase, GAME_ID } from '../../net/supabase';
import { sortChallengeLeaderboardRows } from '../../game/challengeChronicle';
import { render, esc, STARS_BG } from './components';

type Board = 'rivals' | 'challenge' | 'cup' | 'chronicle';

export interface LeaderboardOpts {
  board: Board;
  boards?: Board[];
  title?: string;
  subtitle?: string;
  myUserId: string | null;
  weekKey: string;
  onBack: () => void;
}

interface Row {
  user_id: string;
  points: number;
}

/** Short, anonymous-ish label derived from a user_id (no display_name join). */
function playerLabel(userId: string): string {
  return 'Player ' + userId.slice(0, 4);
}

export function leaderboardScreen(ui: UI, opts: LeaderboardOpts): void {
  const boards = opts.boards ?? (['rivals', 'challenge', 'cup'] as Board[]);
  const label = (b: Board): string => b === 'rivals' ? 'RIVALS' : b === 'challenge' ? 'CHALLENGE' : b === 'cup' ? 'CUP' : 'CHRONICLE';
  const seg = boards
    .map(
      (b) =>
        `<button data-board="${b}" class="${b === opts.board ? 'on' : ''}">${label(b)}</button>`,
    )
    .join('');

  render(
    ui,
    `
    <h1 class="h-screen" style="margin:4px 0 2px">${esc(opts.title ?? 'LEADERBOARD')}</h1>
    <div class="subtle" style="margin-bottom:12px">${esc(opts.subtitle ?? 'Weekly · top scorers')}</div>
    ${boards.length > 1 ? `<div class="seg" style="margin-bottom:14px">${seg}</div>` : ''}
    <div class="panel" style="max-width:520px;display:flex;flex-direction:column;gap:12px">
      <div id="lb-body"><p class="subtle" style="margin:0;text-align:center">Loading…</p></div>
    </div>
    <div class="menu-col" style="margin-top:16px">
      <button class="btn small" id="lb-back">&#9664; BACK</button>
    </div>`,
    STARS_BG,
  );

  bind('lb-back', opts.onBack);
  for (const b of boards) {
    document
      .querySelector(`[data-board="${b}"]`)
      ?.addEventListener('click', () => {
        if (b !== opts.board) leaderboardScreen(ui, { ...opts, board: b });
      });
  }

  const body = document.getElementById('lb-body');
  if (!body) return;

  const note = (msg: string): void => {
    body.innerHTML = `<p class="subtle" style="margin:0;text-align:center">${esc(msg)}</p>`;
  };

  if (!supabase) {
    note('Sign in to compete on the weekly leaderboard.');
    return;
  }

  const week = Number(opts.weekKey.replace(/\D/g, '')) || 0;

  void supabase
    .from('weekly_points')
    .select('user_id,points')
    .eq('game_id', GAME_ID)
    .eq('mode', opts.board)
    .eq('week', week)
    .order('points', { ascending: false })
    .order('user_id', { ascending: true })
    .limit(opts.board === 'chronicle' ? 100 : 25)
    .then(({ data, error }: { data: Row[] | null; error: unknown }) => {
      // Bail if the user navigated away (this body was replaced).
      if (!document.body.contains(body)) return;
      if (error || !data || data.length === 0) {
        note('No scores yet this week — be the first!');
        return;
      }
      const sorted = opts.board === 'chronicle'
        ? sortChallengeLeaderboardRows(data
          .filter((r) => r && typeof r.user_id === 'string')
          .map((r) => ({ ...r, playerLabel: playerLabel(r.user_id), points: Number(r.points ?? 0) })))
        : data.filter((r) => r && typeof r.user_id === 'string');
      const rows = sorted
        .map((r, i) => {
          const you = opts.myUserId && r.user_id === opts.myUserId;
          const player = playerLabel(r.user_id);
          if (opts.board === 'chronicle') {
            const points = Number(r.points ?? 0);
            return `<tr class="${you ? 'you' : ''}">
              <td class="num">${i + 1}</td>
              <td>${esc(player)}${you ? ' <span class="tag">YOU</span>' : ''}</td>
              <td class="num">${points.toLocaleString()}</td>
            </tr>`;
          }
          return `<tr class="${you ? 'you' : ''}">
            <td class="num">${i + 1}</td>
            <td>${esc(player)}${you ? ' <span class="tag">YOU</span>' : ''}</td>
            <td class="num">${Number(r.points ?? 0).toLocaleString()}</td>
          </tr>`;
        })
        .join('');
      body.innerHTML = `
        <table class="tbl">
          <thead>${opts.board === 'chronicle'
            ? '<tr><th class="num">#</th><th>Player</th><th class="num">Score</th></tr>'
            : '<tr><th class="num">#</th><th>Player</th><th class="num">Pts</th></tr>'}</thead>
          <tbody>${rows}</tbody>
        </table>`;
    });
}
