// Constants shared by the server simulation and the browser client.
export const HOURS_PER_YEAR = 8760;
export const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'];
// Default calendar speed: 1 real second = 1 world hour (override with env HOURS_PER_SECOND)
export const DEFAULT_HOURS_PER_SECOND = 1;
// Movement, work and combat run in real time so they are watchable.

export const STATE = {
  IDLE: 0, WALK: 1, FARM: 2, MINE: 3, EAT: 4, DRINK: 5, REST: 6, MARCH: 7, FIGHT: 8,
  FLEE: 9, COURT: 10, PLAY: 11, BUILD: 12, MIGRATE: 13, DEFEND: 14, SICK: 15,
};
export const STATE_NAMES = ['Idle', 'Walking', 'Harvesting', 'Mining', 'Eating', 'Drinking', 'Resting',
  'Marching', 'Fighting', 'Fleeing', 'Courting', 'Playing', 'Building', 'Migrating', 'Defending', 'Sick'];

export const ROLE = { COMMONER: 0, SOLDIER: 1, RULER: 2, CONSORT: 3, ROYAL: 4, GENERAL: 5 };
export const ROLE_NAMES = ['Commoner', 'Soldier', 'Monarch', 'Consort', 'Royal', 'General'];

// agent frame: 16 bytes per person
export const AGENT_BYTES = 16;
export const MSG_AGENTS = 1;
export const MSG_LAND = 2;

export function calendar(hours) {
  const year = Math.floor(hours / HOURS_PER_YEAR);
  const yh = hours - year * HOURS_PER_YEAR;
  const dayOfYear = Math.floor(yh / 24);
  const season = Math.min(3, Math.floor(dayOfYear / 91.25));
  return {
    year: year + 1, day: dayOfYear + 1, hour: Math.floor(yh % 24), season,
    seasonName: SEASONS[season], yearFrac: yh / HOURS_PER_YEAR,
  };
}

// seasonal temperature swing (deg C) for a fraction of the year (0 = start of spring)
export function seasonalOffset(yearFrac) {
  return Math.cos(2 * Math.PI * (yearFrac - 0.375)) * 11;
}
