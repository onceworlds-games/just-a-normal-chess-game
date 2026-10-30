# Just a Normal Chess Game

## The hook
It opens as an ordinary chess game against a bot called Noir, styled like the chess site everyone knows. The first time
White takes a black piece, the black army fuses into **The Endgame**, a dragon built from black chess pieces, and the
board tears open into a 14x20 battlefield. Chess becomes a turn-based war: every piece moves each turn, against Black's
whole army and the dragon at the top of the board.

## What it resembles, and what makes it its own
It resembles a chess site's play-a-bot screen, on purpose, down to the green board, the clocks and the move list. Then it
becomes something no chess game does: real-time chess on a battlefield that keeps growing, where every enemy moves on one
shared 5-second clock and a final boss is literally made of the opponent's pieces. Chess rules stay the language of the
whole game: legal moves, captures, check, castling, promotion, the king that must not fall.

## The first minute
A new player sees a normal chess board with Play under a bot that promises a normal game. They play a few moves; Noir
starts leaving pieces hanging; they take one. The board freezes, the black king's eye turns red, Noir's army flies off
and fuses into a dragon while the board tears open in every direction. The camera settles on their army with
"Defend your king" and Wave 1 counting down: one click on a piece shows its moves, red squares show what Black will take.

## Structure (20-40 minutes)
1. **Chess** (2-5 min). Full legal chess against Noir. Noir plays properly, talks, starts hanging pieces after a few
   moves (it wants to be taken) and never delivers mate. White's first capture triggers the awakening.
2. **The awakening** (10 s). The black king's eye turns red, Noir's pieces fly off and fuse into the dragon, the board
   opens to 14x20, White's recruits appear on the flanks, Black's army rises in lines in front of the dragon.
3. **The battle**, turn based. White moves any number of its pieces (each once), then presses End turn. Black's turn
   plays out move by move: the dragon's announced attack lands, its pieces strike, the Black Court AI moves its army
   (up to 5/7/9 pieces by difficulty), and the dragon may announce its next attack. One army to destroy, then the dragon:
   break its pieces with legal moves; its king is shielded until the heart guard falls. Checkmate it to win.

## Rules of the battlefield
- Pieces move as in chess on the whole board. Pawns march north (White) or south (Black), double-step from their row,
  capture diagonally forward and promote to queens on the far rank.
- Red squares under your pieces: Black can take them next turn. Move them, defend them, or take the attacker first.
- Your king has armour (4/3/2 hits by difficulty): a hit bounces the attacker back and calls Check. Lose it all and
  you go back to the last checkpoint (every 4 turns).
- Black's AI weighs every move: what it takes against what it risks, escaping threats, hunters closing in, guards
  holding posts by the dragon, pawns pushing. Hunters are bold, which is where a sharp player wins pieces.
- Reinforcements: a pawn every 4 turns (and a knight every 8) on your back ranks.

## The dragon's attacks (announced a turn ahead, in red)
Rook Rake (wings): a 7-square stretch of a rank or file. Queen's Rain (feathers): X-shaped strikes on your pieces.
Knight Fork (head): the knight squares around a cluster. Tail Sting (tail): a 3x3 blast. Check (phase 2+): a ghost
attacker aimed at your king; move, block or take it. Summon (phase 1): pawns to refill its line. Its own pieces strike
whatever stands where they attack (two squares for its rooks, bishops and queens).

## Multiplayer
A friends game for up to 4 (`private: true`). Pieces are split by file in the chess phase (a-b, c-d, e-f, g-h for four;
halves for two). New pieces go to the nearest player, balanced by material held. Friends who arrive mid-battle watch
and are seated on White's next turn with a share of the army. The host's page runs the simulation; everyone else sends
commands and draws the host's snapshots (5 a second), predicting their own moves.

## Look
The chess site's look and nothing else: green and cream board, dark warm grey page, bold sans (Figtree), the big green
button, player bars with clocks above and below the board, a move list. After the twist it keeps the same UI and turns
it into the war room: Black's clock counts down to its next move, the opponent bar becomes the dragon's health bar,
the move list panel becomes the turn card (End turn, Undo), the dragon's health and its next attack. Pieces are a chunky flat set drawn in code. The
dragon is drawn from the same black pieces, animated (breathing, flapping wings, swaying tail, glowing eye), and loses
them one by one.

## Stack
Plain ES modules and Canvas 2D, no build. Pure rule modules (chess, Noir, grid rules, the Black Court AI, boss, simulation, codec)
tested with `node --test`, including a full run played by a scripted commander.
