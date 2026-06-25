import type { AdCreative, AdOpportunity, AdPlacementRequest, AdProvider } from './types';

export function dummyPitchBoardCreatives(homeName: string): AdCreative[] {
  return [
    { id: 'dummy-super-league', text: 'SUPER LEAGUE', background: '#0b2a6b', foreground: '#ffd400' },
    { id: 'dummy-home', text: homeName.toUpperCase(), background: '#ffd400', foreground: '#0c1118' },
    { id: 'dummy-meshy', text: 'MESHY SPORTS', background: '#141029', foreground: '#7fb4ff' },
    { id: 'dummy-fal', text: 'FAL RADIO', background: '#7a1530', foreground: '#ffe3ea' },
    { id: 'dummy-cola', text: 'TOP CORNER COLA', background: '#0a6b4a', foreground: '#d8ffe6' },
    { id: 'dummy-cup', text: 'INT. CUP 2026', background: '#0c1118', foreground: '#ffd400' },
    { id: 'dummy-boot-room', text: 'BOOT ROOM', background: '#241a12', foreground: '#ff9a55' },
  ];
}

export function createDummyAdProvider(): AdProvider {
  return {
    getPlacements(request: AdPlacementRequest): AdCreative[] {
      if (request.surface !== 'world_board') return [];
      return dummyPitchBoardCreatives(request.homeName ?? 'HOME');
    },
    recordOpportunity(_opportunity: AdOpportunity): void {
      // Break placements are future inventory only; dummy mode never displays ads.
    },
  };
}
