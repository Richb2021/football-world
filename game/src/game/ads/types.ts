export type AdSurface = 'world_board' | 'ui_panel' | 'break';

export type AdPlacementId =
  | 'pitch_boards'
  | 'pitch_north_left'
  | 'pitch_north_right'
  | 'pitch_south'
  | 'pitch_east'
  | 'pitch_west'
  | 'half_time_break'
  | 'post_match_break'
  | 'challenge_result_break'
  | 'return_to_menu_break';

export interface AdCreative {
  id: string;
  text: string;
  background: string;
  foreground: string;
  imageUrl?: string;
  campaignId?: string;
}

export interface AdPlacementRequest {
  surface: AdSurface;
  placementId: AdPlacementId;
  homeName?: string;
  mode?: string;
}

export interface AdOpportunity {
  surface: AdSurface;
  placementId: AdPlacementId;
  reason?: string;
  mode?: string;
}

export interface AdProvider {
  getPlacements(request: AdPlacementRequest): AdCreative[];
  recordOpportunity(opportunity: AdOpportunity): void;
}
