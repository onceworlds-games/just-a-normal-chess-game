// Every number that shapes the battle. Pure data: imported by the simulation, the renderer and the tests.

// The battlefield after the awakening: 14 files by 20 ranks. Black's army and the dragon hold the top, White the
// bottom. The opening's 8x8 board sits at the bottom middle (a8 at KEEP_X, KEEP_Y).
export const W = 14;
export const H = 20;
export const KEEP_X = 3;
export const KEEP_Y = 12;
export const BOSS_X = 7; // the dragon's king square
export const BOSS_Y = 2;
export const BLACK_PAWN_ROW = 6;
export const WHITE_PAWN_ROW = H - 2;

// Black's turn plays out one action at a time so everyone can follow it (seconds).
export const BEAT_MOVE = 0.28;
export const BEAT_STRIKE = 0.42;
export const BEAT_ATTACK = 1.1;
export const BLACK_TURN_MAX = 6.5; // moves speed up so a long turn still fits in about this long

export const PART_REACH = 2; // the dragon's own pieces strike this far
export const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
export const DAMAGE = { p: 1, n: 2, b: 2, r: 3, q: 4, k: 1 }; // against the dragon's parts
export const CHECKPOINT_EVERY = 4; // white turns
export const HELP_EVERY = 4; // every this many turns each player gets a pawn (and later a knight) on its back rank

export const CINEMATIC = 10; // the awakening

export const DIFFICULTY = {
  casual: { label: 'Casual', army: 'casual', kingHp: 4, maxMoves: 5, risk: 0.7, aggression: 0.6, boss: 0.75, strikes: 1, depth: 2 },
  normal: { label: 'Normal', army: 'normal', kingHp: 3, maxMoves: 7, risk: 1, aggression: 1, boss: 1, strikes: 2, depth: 3 },
  hard: { label: 'Hard', army: 'hard', kingHp: 2, maxMoves: 9, risk: 1.1, aggression: 1.2, boss: 1.2, strikes: 2, depth: 3 },
};
export const DIFF_KEYS = ['casual', 'normal', 'hard'];

// More players: a bigger black army and a tougher dragon.
export const playerScale = (n) => 1 + 0.5 * (Math.max(1, n) - 1);
export const bossScale = (n) => 1 + 0.4 * (Math.max(1, n) - 1);

export const SLOT_COLORS = ['#4aa3ea', '#f0a432', '#b884f0', '#ef6b8f'];
export const SLOT_NAMES = ['Blue', 'Gold', 'Violet', 'Rose'];
export const MAX_SLOTS = 4;

export const TYPES = ['p', 'n', 'b', 'r', 'q', 'k'];
export const SIDES = ['w', 'b', 's']; // white, black, and a spare kind kept for old snapshots
export const NAMES = { p: 'Pawn', n: 'Knight', b: 'Bishop', r: 'Rook', q: 'Queen', k: 'King' };

// Piece flags (piece.st)
export const ST_AIR = 1; // arriving (a summoned pawn, a reinforcement): not on the board until its arc lands
export const ST_MOVED = 2; // White: already moved this turn
export const ST_ELITE = 4; // a crowned black piece (two hits)
export const ST_VET = 8; // promoted
export const ST_GHOST = 16; // a Check attacker conjured by the dragon

// Black's roles (piece.w): how its AI uses each piece.
export const ROLE = { guard: 1, hunter: 2, pawn: 3, summoned: 4 };
