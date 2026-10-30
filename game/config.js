// Every number that shapes the battle. Pure data: imported by the simulation, the renderer and the tests.

export const W = 100;
export const H = 100;

// The dragon's throne (its king square) and the chess board's place in the world (a8 at KEEP_X, KEEP_Y).
export const BOSS_X = 50;
export const BOSS_Y = 36;
export const KEEP_X = 46;
export const KEEP_Y = 58;
export const THRONE_R = 9; // squares closer than this to the throne are sealed until the boss fight
export const RING_R0 = 9; // the rock ring around it
export const RING_R1 = 11.2;

// The battlefield after the awakening, then +1 row or column every GROW_EVERY seconds (N, E, S, W in turn).
export const START_BOUNDS = [34, 22, 65, 70];
export const GROW_EVERY = 10;

export const BLACK_TICK = 5; // every black piece moves once, all at once
export const REACH = 8; // the farthest a rook, bishop or queen slides
export const STONE_REACH = 4;
export const SUMMON_FLIGHT = 1.6; // seconds from a summon to the landing
export const SUMMON_SICK = 1.5; // a piece that landed this recently skips Black's tick

// White's recharge after a move, seconds. A strike on armour or the dragon recharges STRIKE_CD times as long.
export const CD = { p: 2.0, n: 2.5, b: 2.8, r: 3.0, q: 3.5, k: 2.0 };
export const STRIKE_CD = 2;
export const AUTO_DELAY = 0.5; // an enemy must sit in reach this long before a piece takes it by itself

export const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
export const DAMAGE = { p: 1, n: 2, b: 2, r: 3, q: 4, k: 1 }; // against the dragon's parts
export const PROMO_COST = { n: 5, b: 5, r: 9, q: 15 };
export const PAWN_PROMOTES = 3; // captures before a white pawn becomes a queen
export const BLACK_PAWN_PROMOTES = 2;
export const CASTLE_CD = 40;

export const CINEMATIC = 10; // the awakening
export const FIRST_BREAK = 20;
export const BREAK = 25;
export const BOSS_INTRO = 8;

export const DIFFICULTY = {
  casual: { label: 'Casual', enemies: 0.7, armour: 0, boss: 0.7, cunning: 0, depth: 2, attackGap: 1.25, reflex: 0.4 },
  normal: { label: 'Normal', enemies: 1, armour: 0, boss: 1, cunning: 0.5, depth: 3, attackGap: 1, reflex: 1 },
  hard: { label: 'Hard', enemies: 1.35, armour: 1, boss: 1.35, cunning: 0.75, depth: 3, attackGap: 0.82, reflex: -1 },
};
export const DIFF_KEYS = ['casual', 'normal', 'hard'];

// More players: more enemies and a tougher dragon.
export const playerScale = (n) => 1 + 0.55 * (Math.max(1, n) - 1);
export const bossScale = (n) => 1 + 0.45 * (Math.max(1, n) - 1);

export const SLOT_COLORS = ['#4aa3ea', '#f0a432', '#b884f0', '#ef6b8f'];
export const SLOT_NAMES = ['Blue', 'Gold', 'Violet', 'Rose'];
export const MAX_SLOTS = 4;

export const TYPES = ['p', 'n', 'b', 'r', 'q', 'k'];
export const SIDES = ['w', 'b', 's']; // white, black, stone (black's rocks come alive)
export const NAMES = { p: 'Pawn', n: 'Knight', b: 'Bishop', r: 'Rook', q: 'Queen', k: 'King' };

// Piece flags (piece.st)
export const ST_AIR = 1; // summoned, still in the air: lands at piece.cd
export const ST_ORDER = 2; // marching to a target
export const ST_ELITE = 4; // a named elite (a black queen with a crown of hit points)
export const ST_VET = 8; // promoted
export const ST_GHOST = 16; // a Check attacker conjured by the dragon
