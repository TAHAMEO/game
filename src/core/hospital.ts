/**
 * St. Ashgrove General — the only map. Hand-authored structure, randomised contents.
 *
 * Two aligned layers:
 *  STRUCTURE  what is physically there (walls, doors, wall objects, floor markers)
 *  ZONES      which zone every walkable cell belongs to
 *
 * Structure legend
 *   #  wall            .  floor            +  door           =  locked door
 *   L  locker          D  morgue drawer    v  vent grate     t  tap / sink
 *   F  fuse box        R  radio console    G  extraction gate W  window
 *   c  cabinet/shelf   b  bed / gurney     S  player spawn
 *   f  fuse spawn      k  key spawn        i  loose item     n  note
 *   p  survivor spot   x  nest core
 *
 * Zone legend: see ZONES below. `#` = not walkable.
 */

export const STRUCTURE: readonly string[] = [
  '####v#################W#############W########W##################',
  '#......#v####################tt#################################',
  '#.x.x..#..#.......##......##....#.......#...........##..#......#',
  '#..x......#.b..b..#L......##....#.......#.b..b..b...L#..+....b.L',
  '#..x...#..#.......##.f..p.#L..i.#.....f.#.....n.....##..#..f...W',
  '#.x..x.#..+...f...##......##....#..i....#.......b.k.##..#......#',
  '#......#..#.......##......##....#.......#...........##..########',
  '########..#.b..b..#####+#####+######+#######+####+####..#......W',
  '########..#.......=..................................+..+...p..#',
  '########..#########..................................#..#....b.L',
  '##L#####+######################+###v##################..#......#',
  '#......#..#.......###L###v#####..##########L##.......#..########',
  'W....b.+..#.....b.L#..........#..#..........##.b.....#..#......L',
  'W..i...#..+..f....##....n.....#..+..c.c.c.p.##.......+..#...k..L',
  '#......#..#.......#R......i...+..#..c.c.c...#L....f..#..+.n....L',
  '########..#.b.....L#..k.......#..#........f.##.b.....#..#...i..L',
  't......+..#.......##..........#..#..........##.......#..#......L',
  't....k.#..v####################..#######+###v#########..v#######',
  '########..+...........b..............................+..########',
  '#......#..#.................................b........#..########',
  '#....b.+..########v########..######..#####=###########..#......W',
  'L..f...#..#.n.....######................#....#.......#..+.i..b.L',
  '#.b....#..+..i..b.L#####...............n#....#.......#..#...f..#',
  '########..#....p..######.....cc..cc.....#....#..i....+..########',
  'W......#..##############................#....#.b.....#..+......t',
  '#.p.i..+..#.......######.......S......i.#####L.......#..#......t',
  'L....b.#..+..i..b.L#####................##############+#########',
  '#......#..#.......######................##########.............#',
  '########+#################v####=##################.............#',
  '#............##################..#################.............#',
  '#............#######v##########..################v...ccc.......#',
  '#............##..........######..#################...ccc.......#',
  '#...c...c....#D..........######..#######v#########.............#',
  '#............#D..........+.......................+.............#',
  '#............#D..........#.......................#.............#',
  '#............##..f.......####+###v###+######+#####.......ccc...#',
  'G...c...c....#t.....cc...#......##.......#......##.......ccc...#',
  '#............#t.....cc...#......##.......#......L#.............#',
  '#........i...##..........#..cc..#L.......#..f...##.............G',
  '#............#D..........#..ccf.##.......#......L#.............#',
  '#...c...c....#D.......i..#......##..i....#...i..##........i....#',
  '#............##..........#.n....##.......#......##.............#',
  '#............##..........#......#####F############.............#',
  '################D#D#D########t##################################',
];

export const ZONE_LAYER: readonly string[] = [
  '################################################################',
  '#nnnnnn#########################################################',
  '#nnnnnn#oo#ooooooo##uuuuuu##uuuu#uuuuuuu#uuuuuuuuuuu##ee#eeeeee#',
  '#nnnnnnnoo#ooooooo##uuuuuu##uuuu#uuuuuuu#uuuuuuuuuuu##eeeeeeeee#',
  '#nnnnnn#oo#ooooooo##uuuuuu##uuuu#uuuuuuu#uuuuuuuuuuu##ee#eeeeee#',
  '#nnnnnn#oooooooooo##uuuuuu##uuuu#uuuuuuu#uuuuuuuuuuu##ee#eeeeee#',
  '#nnnnnn#oo#ooooooo##uuuuuu##uuuu#uuuuuuu#uuuuuuuuuuu##ee########',
  '########oo#ooooooo#####u#####u######u#######u####u####ee#eeeeee#',
  '########oo#ooooooouuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuueeeeeeeee#',
  '########oo#########uuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuu#ee#eeeeee#',
  '########o######################u######################ee#eeeeee#',
  '#wwwwww#ww#wwwwwww#############hh#############eeeeeee#ee########',
  '#wwwwwwwww#wwwwwww##ssssssssss#hh#ssssssssss##eeeeeee#ee#eeeeee#',
  '#wwwwww#wwwwwwwwww##ssssssssss#hhsssssssssss##eeeeeeeeee#eeeeee#',
  '#wwwwww#ww#wwwwwww##ssssssssssshh#ssssssssss##eeeeeee#eeeeeeeee#',
  '########ww#wwwwwww##ssssssssss#hh#ssssssssss##eeeeeee#ee#eeeeee#',
  '#wwwwwwwww#wwwwwww##ssssssssss#hh#ssssssssss##eeeeeee#ee#eeeeee#',
  '#wwwwww#ww#####################hh#######s#############ee########',
  '########wwhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhee########',
  '#wwwwww#ww#hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh#ee########',
  '#wwwwwwwww#################rr######rr#####r###########ee#eeeeee#',
  '#wwwwww#ww#wwwwwww######rrrrrrrrrrrrrrrr#rrrr#eeeeeee#eeeeeeeee#',
  '#wwwwww#wwwwwwwwww######rrrrrrrrrrrrrrrr#rrrr#eeeeeee#ee#eeeeee#',
  '########ww#wwwwwww######rrrrrrrrrrrrrrrr#rrrr#eeeeeeeeee########',
  '#wwwwww#ww##############rrrrrrrrrrrrrrrr#rrrr#eeeeeee#eeeeeeeee#',
  '#wwwwwwwww#wwwwwww######rrrrrrrrrrrrrrrr######eeeeeee#ee#eeeeee#',
  '#wwwwww#wwwwwwwwww######rrrrrrrrrrrrrrrr##############e#########',
  '#wwwwww#ww#wwwwwww######rrrrrrrrrrrrrrrr##########aaaaaaaaaaaaa#',
  '########w######################r##################aaaaaaaaaaaaa#',
  '#cccccccccccc##################mm#################aaaaaaaaaaaaa#',
  '#cccccccccccc##################mm#################aaaaaaaaaaaaa#',
  '#cccccccccccc##gggggggggg######mm#################aaaaaaaaaaaaa#',
  '#cccccccccccc##gggggggggg######mm#################aaaaaaaaaaaaa#',
  '#cccccccccccc##gggggggggggmmmmmmmmmmmmmmmmmmmmmmmmaaaaaaaaaaaaa#',
  '#cccccccccccc##gggggggggg#mmmmmmmmmmmmmmmmmmmmmmm#aaaaaaaaaaaaa#',
  '#cccccccccccc##gggggggggg####m#######m######m#####aaaaaaaaaaaaa#',
  '#cccccccccccc##gggggggggg#mmmmmm##mmmmmmm#mmmmmm##aaaaaaaaaaaaa#',
  '#cccccccccccc##gggggggggg#mmmmmm##mmmmmmm#mmmmmm##aaaaaaaaaaaaa#',
  '#cccccccccccc##gggggggggg#mmmmmm##mmmmmmm#mmmmmm##aaaaaaaaaaaaa#',
  '#cccccccccccc##gggggggggg#mmmmmm##mmmmmmm#mmmmmm##aaaaaaaaaaaaa#',
  '#cccccccccccc##gggggggggg#mmmmmm##mmmmmmm#mmmmmm##aaaaaaaaaaaaa#',
  '#cccccccccccc##gggggggggg#mmmmmm##mmmmmmm#mmmmmm##aaaaaaaaaaaaa#',
  '#cccccccccccc##gggggggggg#mmmmmm##################aaaaaaaaaaaaa#',
  '################################################################',
];

export interface ZoneDef {
  key: string;
  name: string;
  /** Cold zones fog your breath and show condensation handprints [V]. */
  cold: boolean;
  exterior: boolean;
  /** Wing grouping used by the bait planner when it reasons about "one wing vs another" [T]. */
  wing: 'north' | 'central' | 'east' | 'west' | 'south' | 'nest';
}

export const ZONES: readonly ZoneDef[] = [
  { key: 'n', name: 'The Nest', cold: true, exterior: false, wing: 'nest' },
  { key: 'o', name: 'Old Wing', cold: false, exterior: false, wing: 'west' },
  { key: 'u', name: 'Surgery', cold: false, exterior: false, wing: 'north' },
  { key: 'h', name: 'Main Hall', cold: false, exterior: false, wing: 'central' },
  { key: 's', name: 'Security & Records', cold: false, exterior: false, wing: 'central' },
  { key: 'r', name: 'Reception', cold: false, exterior: false, wing: 'central' },
  { key: 'w', name: 'West Ward', cold: false, exterior: false, wing: 'west' },
  { key: 'e', name: 'East Ward', cold: false, exterior: false, wing: 'east' },
  { key: 'c', name: 'Chapel Garden', cold: true, exterior: true, wing: 'west' },
  { key: 'a', name: 'Ambulance Bay', cold: true, exterior: true, wing: 'east' },
  { key: 'm', name: 'Maintenance', cold: true, exterior: false, wing: 'south' },
  { key: 'g', name: 'Morgue', cold: true, exterior: false, wing: 'south' },
];

export type LockKind = 'maintenance' | 'sealed' | 'pharmacy';

/** Locked doors ('=') by coordinate. Only `maintenance` has a key; the others are false leads [U]. */
export const LOCKS: Readonly<Record<string, LockKind>> = {
  '31,28': 'maintenance',
  '18,8': 'sealed',
  '42,20': 'pharmacy',
};

export const LOCK_LABELS: Readonly<Record<LockKind, string>> = {
  maintenance: 'MAINTENANCE — STAFF ONLY',
  sealed: 'OLD WING — SEALED BY ORDER',
  pharmacy: 'PHARMACY',
};

/** Extraction gates by coordinate. */
export const GATES: Readonly<Record<string, { id: 'bay' | 'garden'; label: string }>> = {
  '63,38': { id: 'bay', label: 'the Ambulance Bay' },
  '0,36': { id: 'garden', label: 'the Chapel Garden gate' },
};

/** Who you are this time. Permadeath: every run is someone new [K]. */
export const CHARACTER_NAMES: readonly string[] = [
  'Night Porter D. Marsh',
  'Nurse A. Okafor',
  'Dr. I. Vance',
  'Orderly T. Lindqvist',
  'Clerk R. Amari',
  'Nurse P. Haldane',
  'Security Officer M. Kowal',
  'Cleaner S. Ferreira',
  'Paramedic J. Achterberg',
  'Chaplain E. Morrow',
];

export interface SurvivorDef {
  name: string;
  /** Clothing colour, used for their sprite — and for the thing that wears them [X]. */
  color: [number, number, number];
  /** Voice signature: speech pitch/rate. The mimic copies it exactly [X]. */
  pitch: number;
  rate: number;
}

export const SURVIVOR_POOL: readonly SurvivorDef[] = [
  { name: 'Mara', color: [70, 150, 110], pitch: 1.25, rate: 0.95 },
  { name: 'Teo', color: [215, 120, 40], pitch: 0.8, rate: 1.05 },
  { name: 'Ines', color: [70, 100, 190], pitch: 1.1, rate: 0.9 },
  { name: 'Walt', color: [150, 140, 120], pitch: 0.65, rate: 0.85 },
];
