/**
 * The 2026 FIFA World Cup field: the 48 qualified nations as drawn into the
 * twelve groups (A–L) at the December 2025 final draw. This is the single
 * source of truth for which teams make up the International Cup — the cup mode
 * uses exactly these, while Exhibition can pick from the wider pool of nations
 * (including sides that did not qualify).
 *
 * Team ids must match the `id` field of the JSON files in src/data/teams/.
 */
export const GROUPS_BY_ID: string[][] = [
  ['mexico', 'south-korea', 'czechia', 'south-africa'],      // Group A
  ['canada', 'bosnia-herzegovina', 'qatar', 'switzerland'],  // Group B
  ['brazil', 'morocco', 'haiti', 'scotland'],                // Group C
  ['usa', 'paraguay', 'australia', 'turkey'],                // Group D
  ['curacao', 'ecuador', 'germany', 'ivory-coast'],          // Group E
  ['japan', 'netherlands', 'sweden', 'tunisia'],             // Group F
  ['belgium', 'egypt', 'iran', 'new-zealand'],               // Group G
  ['cape-verde', 'saudi-arabia', 'spain', 'uruguay'],        // Group H
  ['france', 'iraq', 'norway', 'senegal'],                   // Group I
  ['algeria', 'argentina', 'austria', 'jordan'],             // Group J
  ['colombia', 'dr-congo', 'portugal', 'uzbekistan'],        // Group K
  ['croatia', 'england', 'ghana', 'panama'],                 // Group L
];

/** Flattened list of the 48 qualified team ids (the International Cup field). */
export const WC_TEAM_IDS: string[] = GROUPS_BY_ID.flat();

/** True if a team id is one of the 48 World Cup qualifiers. */
export function isWorldCupTeam(id: string): boolean {
  return WC_TEAM_IDS.includes(id);
}

/**
 * The 16 real host stadiums of the 2026 FIFA World Cup, across the USA, Canada
 * and Mexico. International Cup matches are played at one of these, chosen at
 * random per fixture, instead of a team's club ground.
 */
export const WORLD_CUP_VENUES: { name: string; city: string }[] = [
  { name: 'MetLife Stadium', city: 'New York / New Jersey' },
  { name: 'SoFi Stadium', city: 'Los Angeles' },
  { name: 'AT&T Stadium', city: 'Dallas' },
  { name: 'Mercedes-Benz Stadium', city: 'Atlanta' },
  { name: 'NRG Stadium', city: 'Houston' },
  { name: 'Arrowhead Stadium', city: 'Kansas City' },
  { name: 'Lincoln Financial Field', city: 'Philadelphia' },
  { name: 'Gillette Stadium', city: 'Boston' },
  { name: 'Levi’s Stadium', city: 'San Francisco Bay Area' },
  { name: 'Lumen Field', city: 'Seattle' },
  { name: 'Hard Rock Stadium', city: 'Miami' },
  { name: 'Estadio Azteca', city: 'Mexico City' },
  { name: 'Estadio BBVA', city: 'Monterrey' },
  { name: 'Estadio Akron', city: 'Guadalajara' },
  { name: 'BC Place', city: 'Vancouver' },
  { name: 'BMO Field', city: 'Toronto' },
];
