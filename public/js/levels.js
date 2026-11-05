// "ESCAPE THE CITY" — six chapters built on real photogrammetry scans.
// Story: Day 9 of the outbreak. Your squad was cut off from the evac convoy downtown. The last military radio
// broadcast says a supply train will run the old tunnel line out of the city at dawn. You have to get there.
// Each chapter is a real scanned location; reach the exit marker to move on. Revival stations open every 5 minutes.
export const LEVELS = [
  {
    id: 'alley', name: 'CHAPTER 1 · BACK STREET', file: 'alley', scale: 0.01,
    story: ['Day 9. The convoy left without you.', 'The radio says: tunnel line, dawn, one train. Move.'],
    objective: 'Push through the alley',
    bounds: [[-24, -1, -4.1], [29.6, 7, 4.3]], mirrorZ: 0.1, cell: 0.35, floorY: 0.3, step: 1.25, fill: 3,
    start: [27.5, 0.3, -0.8], exit: [-23, 0.3, -0.8], yaw: Math.PI / 2,
    fog: [0x9aa2aa, 0.012], sky: 0x3b4048, sun: [0xfff1dc, 1.4, [20, 40, 10]], hemi: [0xbfc8d6, 0x3a3226, 1.1], exposure: 1.0,
    zombies: { max: 10, total: 26, types: ['copzombie', 'warzombie', 'scan_z1', 'prisoner', 'zombiegirl'] }, lit: true,
    props: [{ kind: 'barrel', at: [10, 0.3, -1.4] }, { kind: 'crate', at: [0, 0.3, -0.4] }, { kind: 'barrel', at: [-12, 0.3, -1.2] }, { kind: 'light', at: [4, 3.2, -0.8] }, { kind: 'light', at: [-14, 3.2, -0.8] }],
  },
  {
    id: 'house', name: 'CHAPTER 2 · THE ABANDONED HOUSE', file: 'house',
    story: ['Footsteps upstairs. Someone was living here.', 'Find the way out through the back rooms.'],
    objective: 'Search the house — find the back exit',
    bounds: [[-9.5, -4, -16.6], [20, 9, 28.9]], cell: 0.45, floorY: -1,
    start: [11.4, 0.5, -15], exit: [5.1, 3.3, 27.7], yaw: Math.PI,
    fog: [0x17130f, 0.06], sky: 0x15120e, sun: [0xffd6a0, 0.6, [10, 30, -20]], hemi: [0xb0a490, 0x2a2118, 0.9], exposure: 1.05,
    zombies: { max: 12, total: 32, types: ['scan_z2', 'romero', 'zombiegirl', 'parasite', 'scan_z4', 'copzombie'] }, dark: true,
    props: [{ kind: 'light', at: [8, 3, -6], flicker: true }, { kind: 'light', at: [6, 3, 10], flicker: true }, { kind: 'light', at: [4, 3, 22], flicker: true }, { kind: 'crate', at: [9, 0.5, -10] }, { kind: 'barrel', at: [3, 0.5, 4] }],
  },
  {
    id: 'garage', name: 'CHAPTER 3 · PARKING GARAGE', file: 'garage',
    story: ['Underground. Generators still humming.', 'Car alarms will bring every one of them. Do not shoot the cars.'],
    objective: 'Cross the garage to the stairwell',
    bounds: [[-30, -1.4, 0], [70, 6, 100]], cell: 0.7, floorY: 0,
    start: [68.3, 0, 24.8], exit: [-28.2, -0.4, 1.8],
    fog: [0x0c0f12, 0.045], sky: 0x05070a, sun: [0xffffff, 0.15, [0, 30, 0]], hemi: [0x8a95a8, 0x1a1c20, 0.4], exposure: 0.75,
    zombies: { max: 16, total: 44, types: ['warzombie', 'skeletonzombie', 'scan_z1', 'scan_z2', 'mutant', 'copzombie', 'prisoner'] }, dark: true,
    props: [{ kind: 'car', at: [50, 0, 20] }, { kind: 'car', at: [20, 0, 12] }, { kind: 'wreck', at: [35, 0, 30] }, { kind: 'barrel', at: [58, 0, 22] }, { kind: 'barrel', at: [28, 0, 18] }, { kind: 'barrel', at: [5, 0, 6] }, { kind: 'crate', at: [42, 0, 26] },
      { kind: 'light', at: [60, 3.2, 24], flicker: true }, { kind: 'light', at: [40, 3.2, 22] }, { kind: 'light', at: [20, 3.2, 16], flicker: true }, { kind: 'light', at: [0, 3.2, 6] }, { kind: 'light', at: [-20, 3.2, 3], flicker: true }],
  },
  {
    id: 'station', name: 'CHAPTER 4 · CROUCH END STATION', file: 'station',
    story: ['The old platform. Overgrown, but the line is still here.', 'Hold the platform until the signal box is open.'],
    objective: 'Cross the platform to the signal box',
    bounds: [[-22, -2, -22.7], [22.3, 8, 19.3]], cell: 0.6, floorY: 4.5,
    start: [20.9, 4.8, -10.4], exit: [-13.3, 5.5, -17.6],
    fog: [0xa9b2b8, 0.01], sky: 0xaab4bb, sun: [0xfff6e6, 2.2, [30, 50, 20]], hemi: [0xdfe8f0, 0x4a5a3a, 1.2], exposure: 1.0,
    zombies: { max: 18, total: 50, types: ['scan_z1', 'scan_z2', 'scan_z4', 'girlscout', 'zombiegirl', 'copzombie', 'warzombie', 'parasite'] }, lit: true,
    props: [{ kind: 'wreck', at: [-8, 6, -15] }, { kind: 'barrel', at: [-5, 6, -19] }, { kind: 'barrel', at: [-12, 6, -12] }, { kind: 'crate', at: [-4, 6, -17] }],
  },
  {
    id: 'factory', name: 'CHAPTER 5 · POLYGRAPH FACTORY', file: 'factory',
    story: ['The factory yard. The tunnel entrance is past it.', 'Something big lives here. Stay together.'],
    objective: 'Get through the factory yard',
    bounds: [[-13.8, -1, -21.4], [19.8, 10, 14.9]], cell: 0.6, floorY: 1.5,
    start: [9.9, 1.6, -16.9], exit: [-3.9, 1.5, 8.9],
    fog: [0xa69f91, 0.012], sky: 0x8c867c, sun: [0xffe2b8, 1.8, [-20, 40, 30]], hemi: [0xd8d0c0, 0x3c3428, 1.0], exposure: 1.0,
    zombies: { max: 20, total: 60, types: ['mutant', 'scan_z2', 'romero', 'skeletonzombie', 'warzombie', 'scan_z4', 'scan_z1'] }, lit: true,
    props: [{ kind: 'barrel', at: [7, 3, -10] }, { kind: 'barrel', at: [2, 3, 0] }, { kind: 'wreck', at: [4, 3, -5] }, { kind: 'crate', at: [0, 3, 4] }],
  },
  {
    id: 'tunnel', name: 'CHAPTER 6 · THE TUNNEL LINE', file: 'tunnel',
    story: ['Dawn. The train is waiting at the far end of the tunnel.', 'Every one of them in the city heard you coming. RUN.'],
    objective: 'Reach the train at the end of the tunnel',
    bounds: [[-20, -1.2, -120], [21.7, 12, 120]], cell: 0.8, floorY: 0,
    start: [-2, 3.1, 118], exit: [-3.6, 1.9, -118], yaw: 0, final: true,
    fog: [0x0a0b0c, 0.05], sky: 0x050505, sun: [0xffffff, 0.1, [0, 30, 0]], hemi: [0x8c8f96, 0x18181a, 0.45], exposure: 1.15,
    zombies: { max: 24, total: 90, types: ['scan_z1', 'scan_z2', 'scan_z4', 'warzombie', 'copzombie', 'skeletonzombie', 'mutant', 'romero', 'prisoner', 'parasite', 'zombiegirl', 'girlscout'] }, dark: true,
    props: [{ kind: 'light', at: [0, 5, 90] }, { kind: 'light', at: [0, 5, 50], flicker: true }, { kind: 'light', at: [0, 5, 10] }, { kind: 'light', at: [0, 5, -30], flicker: true }, { kind: 'light', at: [0, 5, -70] }, { kind: 'light', at: [0, 5, -105] },
      { kind: 'wreck', at: [3, 1.9, 60] }, { kind: 'car', at: [-4, 1.9, 20] }, { kind: 'barrel', at: [5, 1.9, 0] }, { kind: 'barrel', at: [-6, 1.9, -50] }],
  },
];

// Zombie archetypes: shared skeleton, so any body can play any behaviour.
export const ZTYPES = {
  walker: { hp: 110, speed: [1.1, 1.6], dmg: 14, reach: 1.25, anim: 'anim_z_walk', run: false },
  shambler: { hp: 140, speed: [0.8, 1.1], dmg: 18, reach: 1.25, anim: 'anim_z_walk_creep', run: false },
  runner: { hp: 85, speed: [3.4, 4.2], dmg: 10, reach: 1.3, anim: 'anim_z_run', run: true },
  brute: { hp: 420, speed: [1.6, 2.0], dmg: 32, reach: 1.6, anim: 'anim_z_walk', run: false, scale: 1.18 },
};
// bodies that read as big get the brute behaviour more often
export const BODY_HINT = { mutant: 'brute', romero: 'shambler', skeletonzombie: 'runner', parasite: 'runner', zombiegirl: 'runner', girlscout: 'runner' };
export const CREDITS = [
  ['Back Street Alley Photogrammetry Scan', 'YEUX-01', 'CC BY 4.0'], ['abandoned house interior', 'Δ (sakis259106)', 'CC BY 4.0'],
  ['Basement Parking Garage Environment Underground', 'PolyNeast', 'Sketchfab Standard'], ['Crouch End Station', 'artfletch', 'CC BY 4.0'],
  ['Abandoned Building: Polygraphenwerk Leipzig', 'Geddart', 'CC BY 4.0'], ['Futatsugoya Tunnel “Abandoned road”', 'Fuji', 'CC BY 4.0'],
  ['Destroyed Car 03 (Raw Scan)', 'Renafox', 'CC BY 4.0'], ['Zombie Walk Test', 'OSCAR CREATIVO', 'CC BY 4.0'],
  ['Zombie', 'David Glynch', 'Sketchfab Standard'], ['Zombie Hazmat', 'LxNazarov', 'CC BY 4.0'], ['Realistic Zombie Hitman', 'Jungle Jim', 'CC BY 4.0'],
  ['Zombie (Rigged & Animated)', 'Aiden Studios', 'CC BY 4.0'], ['Zombie Mutant', 'L.', 'CC BY 4.0'],
  ['Characters & animations', 'Adobe Mixamo', 'Mixamo licence'], ['FPS AK-74m animations', 'Cransh', 'CC BY 4.0'],
];
