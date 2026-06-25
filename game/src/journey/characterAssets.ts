const ROOT = 'assets/journey/characters/';

const PLAYER_SPRITE = `${ROOT}young_teammate_red_kit.webp`;

const CHARACTER_ASSETS: Record<string, string> = {
  manager_clough: `${ROOT}manager_overcoat.webp`,
  assistant_taylor: `${ROOT}assistant_clipboard.webp`,
  physio_morris: `${ROOT}physio_bag.webp`,
  captain_whitlock: `${ROOT}captain_red_kit.webp`,
  teammate_webb: PLAYER_SPRITE,
  teammate_stone: `${ROOT}rival_training_top.webp`,
  teammate_hargreaves: `${ROOT}rival_training_top.webp`,
  dad: `${ROOT}dad_casual.webp`,
  reporter_local: `${ROOT}reporter_notepad.webp`,
  landlord_pub: `${ROOT}pub_landlord.webp`,
  scout_maddox: `${ROOT}assistant_clipboard.webp`,
  youth_coach_maddox: `${ROOT}england_youth_coach.webp`,
  germany_captain_adler: `${ROOT}germany_defender.webp`,
  agent_coyle: `${ROOT}agent_phone.webp`,
  doctor_evans: `${ROOT}physio_bag.webp`,
  rival_malone: `${ROOT}rival_training_top.webp`,
  club_secretary_banks: `${ROOT}assistant_clipboard.webp`,
  mum: `${ROOT}dad_casual.webp`,
  opposition_scout_reid: `${ROOT}reporter_notepad.webp`,
  ty_chairman_douglas: `${ROOT}ty_chairman_douglas.webp`,
  ty_assistant_roper: `${ROOT}ty_assistant_roper.webp`,
  ty_coach_bell: `${ROOT}ty_coach_bell.webp`,
  ty_striker_hayle: `${ROOT}ty_striker_hayle.webp`,
  ty_winger_maddox: `${ROOT}ty_winger_maddox.webp`,
  ty_defender_reece: `${ROOT}ty_defender_reece.webp`,
  ty_reporter_keane: `${ROOT}ty_reporter_keane.webp`,
  ty_captain_benton: `${ROOT}ty_captain_benton.webp`,
  te_chairman_ward: `${ROOT}te_chairman_ward.webp`,
  te_manager_briggs: `${ROOT}te_manager_briggs.webp`,
  te_captain_hobbs: `${ROOT}te_captain_hobbs.webp`,
  te_teammate_varga: `${ROOT}te_teammate_varga.webp`,
  te_rival_kane: `${ROOT}te_rival_kane.webp`,
  te_reporter_sloan: `${ROOT}te_reporter_sloan.webp`,
  te_dad: `${ROOT}te_dad.webp`,
  te_agent_miles: `${ROOT}te_agent_miles.webp`,
  // International Cup Story (2026) cast
  rival_dane: `${ROOT}rival_dane.webp`,
  mentor_okafor: `${ROOT}mentor_okafor.webp`,
  chairman_voss: `${ROOT}chairman_voss.webp`,
  sister_mia: `${ROOT}sister_mia.webp`,
  agent_rival_sharpe: `${ROOT}agent_rival_sharpe.webp`,
  pundit_grady: `${ROOT}pundit_grady.webp`,
  physio_lane: `${ROOT}physio_lane.webp`,
  teammate_reyes: `${ROOT}teammate_reyes.webp`,
  england_roommate_fox: `${ROOT}england_roommate_fox.webp`,
  national_manager_strand: `${ROOT}national_manager_strand.webp`,
  // Last Dance cast
  ld_coach_baptiste: `${ROOT}manager_overcoat.webp`,
  ld_physio_mara: `${ROOT}physio_bag.webp`,
  ld_young_striker_elian: `${ROOT}young_teammate_red_kit.webp`,
  ld_daughter_lina: `${ROOT}ld_daughter_lina.webp`,
  ld_president_santos: `${ROOT}chairman_voss.webp`,
  ld_reporter_vega: `${ROOT}reporter_notepad.webp`,
  ld_captain_rui: `${ROOT}captain_red_kit.webp`,
  // Two Passports cast
  tp_birth_assistant_miller: `${ROOT}assistant_clipboard.webp`,
  tp_heritage_manager_desrosiers: `${ROOT}manager_overcoat.webp`,
  tp_grandmother_ana: `${ROOT}tp_grandmother_ana.webp`,
  tp_agent_reece: `${ROOT}agent_phone.webp`,
  tp_birth_teammate_brooks: `${ROOT}england_roommate_fox.webp`,
  tp_heritage_captain_etienne: `${ROOT}captain_red_kit.webp`,
  tp_reporter_malik: `${ROOT}reporter_notepad.webp`,
  // Historic Miners' Cup cast
  mc_captain_eddie: `${ROOT}mc_captain_eddie.webp`,
  mc_secretary_hawthorn: `${ROOT}mc_secretary_hawthorn.webp`,
  mc_foreman_doyle: `${ROOT}mc_foreman_doyle.webp`,
  mc_wife_mary: `${ROOT}mc_wife_mary.webp`,
  mc_organiser_bell: `${ROOT}mc_organiser_bell.webp`,
  mc_turin_clerk_luca: `${ROOT}mc_turin_clerk_luca.webp`,
  // Historic First Eleven cast
  fe_captain_muir: `${ROOT}fe_captain_muir.webp`,
  fe_secretary_mackay: `${ROOT}fe_secretary_mackay.webp`,
  fe_newspaper_bell: `${ROOT}fe_newspaper_bell.webp`,
  fe_english_captain_hart: `${ROOT}fe_english_captain_hart.webp`,
  fe_goalkeeper_fergus: `${ROOT}fe_goalkeeper_fergus.webp`,
  fe_fa_messenger_alden: `${ROOT}fe_fa_messenger_alden.webp`,
};

export function getJourneyCharacterAsset(npcId: string): string {
  return CHARACTER_ASSETS[npcId] ?? PLAYER_SPRITE;
}

/** true when a hand-made portrait exists for this NPC; otherwise the renderer
 * falls back to a distinct procedural avatar so new characters still look unique. */
export function hasJourneyCharacterAsset(npcId: string): boolean {
  return npcId in CHARACTER_ASSETS;
}
