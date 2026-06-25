import { describe, expect, it } from 'vitest';
import { createDummyAdProvider } from '../dummyProvider';

describe('DummyAdProvider', () => {
  it('returns deterministic pitch board creative with the home team inserted', () => {
    const provider = createDummyAdProvider();

    const creatives = provider.getPlacements({
      surface: 'world_board',
      placementId: 'pitch_boards',
      homeName: 'Cape Verde',
    });

    expect(creatives.map((creative) => creative.text)).toEqual([
      'SUPER LEAGUE',
      'CAPE VERDE',
      'MESHY SPORTS',
      'FAL RADIO',
      'TOP CORNER COLA',
      'INT. CUP 2026',
      'BOOT ROOM',
    ]);
    expect(creatives.every((creative) => creative.background && creative.foreground)).toBe(true);
  });

  it('ignores break opportunities without throwing or returning live ads', () => {
    const provider = createDummyAdProvider();

    expect(() => provider.recordOpportunity({
      placementId: 'half_time_break',
      surface: 'break',
      reason: 'half_time',
    })).not.toThrow();
  });
});
