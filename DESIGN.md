# Just a Normal Chess Game

## The hook
It opens as an ordinary chess game against a bot called Noir, styled like the chess site everyone knows. The first time
White takes a black piece, the black army fuses into **The Endgame**, a dragon built from black chess pieces, and the
board tears open into a 100×100 battlefield. Chess becomes a real-time siege: ten waves, then the boss.

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

## Structure (about an hour)
1. **Chess** (2-5 min). Full legal chess against Noir. Noir plays properly but starts hanging pieces after a few moves:
   it wants to be taken. White's first capture (or mating Noir) triggers the awakening.
2. **The awakening** (10 s). Freeze, the black king's eye turns red, black pieces fly off and fuse into the dragon, the
   board ripples outward, rocks rise around the dragon's throne, hidden white pieces pop up across the new ground.
3. **Waves 1-10** (35-40 min). The dragon summons black pieces that land near White's forces. All black pieces move at
   once, one move every 5 seconds (Black's chess clock counts it down). White pieces move whenever they are ready (a
   2-3.5 s recharge per piece). Between waves: 25 s, reinforcements, a checkpoint. From wave 3 the dragon tries out the
   attacks it will use in the fight, one at a time, so players learn them before they matter.
4. **The board grows** by one row or column every 10 seconds (cycling north, east, south, west) until it reaches
   100×100, revealing scattered white squads (new pieces for the nearest player) and a few sleeping black pieces.
5. **The boss** (10-15 min). After wave 10 the rock ring cracks: a quarter of it wakes as stone rooks, the rest crumbles.
   The dragon's parts are pieces on squares: strike them with legal moves to break them off. Breaking a group (a wing,
   the feathers, the head, the tail) removes its attack. The king at its heart is shielded until the eight torso pieces
   around it are gone. Checkmate the king to win.

## Rules of the battlefield
- Pieces move as in chess. Sliders reach at most 8 squares (one board). Pawns face the dragon (black pawns face their
  prey) and capture diagonally forward. Rocks, the sealed throne and the void block movement and lines.
- Black captures happen on Black's tick. A white piece standing on a square a black piece attacks glows red: move it,
  or take the attacker first. Your king glows red and the screen says CHECK.
- White pieces capture on their own when an enemy wanders into reach and the trade is sound (auto-capture, a toggle).
- Select one piece: legal squares show as dots, threatened ones red. Click a dot to move; click anywhere else to march
  there. Drag a box (or long-press on touch) to select a group and send it anywhere: they march and fight on the way.
- Material from captures (pawn 1, minor 3, rook 5, queen 9) buys promotions for your pawns. A pawn that captures three
  times promotes to a queen; a black pawn that captures twice does too.
- Armoured pieces (a gold rim, pips for hits left) take more than one hit: a hit bounces the attacker back.
- The king's owner can Castle: swap the king with their nearest rook (every 40 s).
- Lose the king and the run is lost: retry from the last checkpoint (wave start) as often as you like.

## Boss attacks (all telegraphed in red, with time to react)
- Rook Rake (wings): whole ranks or files light up, then a shockwave runs along them.
- Queen's Rain (feathers): X-shaped queen strikes on clusters.
- Knight Fork (head): the eight knight squares around a target.
- Tail Sting (tail): a plus-shaped blast.
- Check (phase 2+): ghost attackers appear on lines to your king. Move the king, block the line or take the ghost.
- Flight (phase 2+): the dragon takes off and lands on a marked footprint near your army.
- Roar (phase 3): every black piece moves at once, out of turn.
- Summon: more black pieces.

## Multiplayer
A friends game for up to 4 (`private: true`). Pieces are split by file in the chess phase (a-b, c-d, e-f, g-h for four;
halves for two). New pieces go to the nearest player, balanced by material held. Friends who arrive mid-run watch
and are admitted at the next wave break with a fresh squad. The host's page runs the simulation; everyone else sends
commands and draws the host's snapshots (5 a second), predicting their own moves.

## Look
The chess site's look and nothing else: green and cream board, dark warm grey page, bold sans (Figtree), the big green
button, player bars with clocks above and below the board, a move list. After the twist it keeps the same UI and turns
it into the war room: Black's clock counts down to its next move, the opponent bar becomes the dragon's health bar,
the move list panel becomes the wave card, minimap and selection. Pieces are a chunky flat set drawn in code. The
dragon is drawn from the same black pieces, animated (breathing, flapping wings, swaying tail, glowing eye), and loses
them one by one.

## Stack
Plain ES modules and Canvas 2D, no build. Pure rule modules (chess, AI, grid rules, waves, boss, simulation, codec)
tested with `node --test`, including a full run played by a scripted commander.
