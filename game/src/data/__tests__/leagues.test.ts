import { describe, expect, it } from 'vitest';
import { LEAGUES } from '../leagues';
import { WC_TEAM_IDS, GROUPS_BY_ID } from '../worldCup';
import { FORMATIONS, lineupSlotFits, teamDefaultLineup } from '../../sim/formations';

const HEX = /^#[0-9a-fA-F]{6}$/;

describe('league registry', () => {
  it('registers the International Cup as exactly the 48 World Cup qualifiers', () => {
    const league = LEAGUES.find((l) => l.id === 'international-cup');

    expect(league?.name).toBe('International Cup');
    expect(league?.teams).toHaveLength(48);
    expect(league!.teams.every((t) => t.players.length >= 11)).toBe(true);
    // every cup team is a qualifier, and none of the non-qualifiers slipped in
    expect(league!.teams.every((t) => WC_TEAM_IDS.includes(t.id))).toBe(true);
  });

  it('exposes an All Nations league that is a superset of the cup field', () => {
    const all = LEAGUES.find((l) => l.id === 'all-nations');
    const cup = LEAGUES.find((l) => l.id === 'international-cup');

    expect(all).toBeTruthy();
    expect(all!.teams.length).toBeGreaterThanOrEqual(cup!.teams.length);
    // the qualifiers are all present in the wider pool too
    expect(cup!.teams.every((t) => all!.teams.some((x) => x.id === t.id))).toBe(true);
  });

  it('has a valid 12-group draw where every qualifier appears exactly once', () => {
    expect(GROUPS_BY_ID).toHaveLength(12);
    expect(GROUPS_BY_ID.every((g) => g.length === 4)).toBe(true);
    expect(WC_TEAM_IDS).toHaveLength(48);
    expect(new Set(WC_TEAM_IDS).size).toBe(48); // no duplicates
    // every id in the draw resolves to a real team file
    const cup = LEAGUES.find((l) => l.id === 'international-cup')!;
    expect(WC_TEAM_IDS.every((id) => cup.teams.some((t) => t.id === id))).toBe(true);
  });

  it('uses complete 26-player World Cup squads with appearance metadata and real default XIs', () => {
    const cup = LEAGUES.find((l) => l.id === 'international-cup')!;

    for (const team of cup.teams) {
      expect(team.players).toHaveLength(26);
      expect(team.players.map((p) => p.shirtNumber).sort((a, b) => a! - b!)).toEqual(
        Array.from({ length: 26 }, (_, i) => i + 1),
      );
      for (const player of team.players) {
        expect(player.appearance?.skinTone).toMatch(HEX);
        expect(player.appearance?.hairColor).toMatch(HEX);
        expect(player.appearance?.hairStyle).toMatch(/^(short|crop|curly|bald|long)$/);
      }

      expect(team.defaultLineup?.formation).toBeTruthy();
      expect(FORMATIONS[team.defaultLineup!.formation]).toBeTruthy();
      expect(team.defaultLineup!.starters).toHaveLength(11);
      expect(new Set(team.defaultLineup!.starters).size).toBe(11);
      expect(team.defaultLineup!.starters.every((idx) => idx >= 0 && idx < team.players.length)).toBe(true);
      expect(team.players[team.defaultLineup!.starters[0]].pos).toBe('GK');

      const resolved = teamDefaultLineup(team);
      expect(resolved.starters).toHaveLength(11);
      resolved.starters.forEach((idx, slotIdx) => {
        expect(lineupSlotFits(team.players[idx], resolved.formation, slotIdx)).toBe(true);
      });
    }
  });

  it('keeps non-tournament standard nations on curated appearance data', () => {
    const all = LEAGUES.find((l) => l.id === 'all-nations')!;
    const nonTournament = all.teams.filter((team) => !WC_TEAM_IDS.includes(team.id));

    expect(nonTournament).toHaveLength(16);
    for (const team of nonTournament) {
      expect(team.players).toHaveLength(23);
      for (const player of team.players) {
        expect(player.appearance?.skinTone).toMatch(HEX);
        expect(player.appearance?.hairColor).toMatch(HEX);
        expect(player.appearance?.hairStyle).toMatch(/^(short|crop|curly|bald|long)$/);
      }
    }

    const player = (teamId: string, name: string) => {
      const team = all.teams.find((t) => t.id === teamId)!;
      return team.players.find((p) => p.name === name)!;
    };

    expect(player('cameroon', 'Andre Onanae').appearance).toMatchObject({
      skinTone: '#2f1b14',
      hairColor: '#17110d',
      hairStyle: 'crop',
    });
    expect(player('nigeria', 'Victor Osimhene').appearance).toMatchObject({
      skinTone: '#2f1b14',
      hairColor: '#caa463',
      hairStyle: 'crop',
    });
    expect(player('italy', 'Riccardo Calafiorie').appearance).toMatchObject({
      skinTone: '#d9a173',
      hairColor: '#4b2d1b',
      hairStyle: 'long',
    });
    expect(player('denmark', 'Kasper Shmeichel').appearance).toMatchObject({
      skinTone: '#d9a173',
      hairColor: '#caa463',
      hairStyle: 'short',
    });
    expect(player('uae', 'Ali Mabkhoute').appearance).toMatchObject({
      skinTone: '#a96a42',
      hairColor: '#17110d',
      hairStyle: 'short',
    });
  });
});
