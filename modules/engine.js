/* ═══════════════════════════════════════════════════
   MODULE: engine.js
   Handles: Game constants, board logic, move generation,
            AI (minimax), rendering, timers, win modal, undo
═══════════════════════════════════════════════════ */

import { tgHaptic, showScreen } from './telegram.js';
import { applyPieceTheme } from './ui.js';

/* ── Constants ── */
export const EMPTY  = 0;
export const BLACK  = 1;   // Player 1 – moves up (rows 7→0)
export const WHITE  = 2;   // Player 2 / AI – moves down (rows 0→7)
export const B_KING = 3;
export const W_KING = 4;

/* ── Game State ── */
export let G = {};

export function freshState() {
  return {
    // Debug flag – set to true for development to enable console logs
    debug: true,
    board: initBoard(),
    turn: BLACK,
    mode: 'pvp',
    difficulty: 'medium',
    selected: null,
    validMoves: [],
    mustCapture: null,
    chainCaptured: null,
    moveCount: 0,
    captured: { [BLACK]: 0, [WHITE]: 0 },
    history: [],
    gameOver: false,
    startTime: Date.now(),
    timers: { [BLACK]: 0, [WHITE]: 0 },
    timerInterval: null,
    lastTick: Date.now(),
    // ── Turn countdown ──
    countdown: 20,           // seconds left this turn
    countdownInterval: null, // setInterval handle
    strikes: { [BLACK]: 0, [WHITE]: 0 }, // timeout strikes per player
    MAX_STRIKES: 3,
    TURN_SECONDS: 20,
    // ── Solo-king stalling rule ──
    soloKingPlayer: null,  // BLACK or WHITE — the player with 1 lone king
    soloKingMoves:  0,     // consecutive moves made by that lone king
    SOLO_KING_LIMIT: 10,   // move limit before loss
  };
}

export function initBoard() {
  const b = Array.from({ length: 8 }, () => Array(8).fill(EMPTY));
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 8; c++)
      if ((r + c) % 2 !== 0) b[r][c] = WHITE;
  for (let r = 5; r < 8; r++)
    for (let c = 0; c < 8; c++)
      if ((r + c) % 2 !== 0) b[r][c] = BLACK;
  return b;
}

/* ── Move helpers ── */
export function isOwn(piece, player) {
  if (player === BLACK) return piece === BLACK || piece === B_KING;
  return piece === WHITE || piece === W_KING;
}
export function isEnemy(piece, player) {
  if (piece === EMPTY) return false;
  return !isOwn(piece, player);
}
export function isKing(piece) { return piece === B_KING || piece === W_KING; }

/* ── Normal piece moves & captures ── */
export function getNormalMoves(board, r, c, player, onlyCaptures) {
  const moves = [];
  if (!onlyCaptures) {
    const fwdDirs = player === BLACK ? [[-1,-1],[-1,1]] : [[1,-1],[1,1]];
    for (const [dr, dc] of fwdDirs) {
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && board[nr][nc] === EMPTY)
        moves.push({ r: nr, c: nc, capturedSquare: null });
    }
  }
  for (const [dr, dc] of [[-1,-1],[-1,1],[1,-1],[1,1]]) {
    const mr = r + dr, mc = c + dc;
    const lr = r + 2*dr, lc = c + 2*dc;
    if (mr < 0 || mr >= 8 || mc < 0 || mc >= 8) continue;
    if (lr < 0 || lr >= 8 || lc < 0 || lc >= 8) continue;
    if (!isEnemy(board[mr][mc], player)) continue;
    if (board[lr][lc] !== EMPTY) continue;
    moves.push({ r: lr, c: lc, capturedSquare: { mr, mc } });
  }
  return moves;
}

/* ── Queen (king) moves ── */
export function getQueenMoves(board, r, c, player, onlyCaptures, alreadyCaptured) {
  const moves = [];
  for (const [dr, dc] of [[-1,-1],[-1,1],[1,-1],[1,1]]) {
    let cr = r + dr, cc2 = c + dc;
    let foundEnemy = null;
    while (cr >= 0 && cr < 8 && cc2 >= 0 && cc2 < 8) {
      const sq = board[cr][cc2];
      if (foundEnemy === null) {
        if (sq === EMPTY) {
          if (!onlyCaptures) moves.push({ r: cr, c: cc2, capturedSquare: null });
        } else if (isEnemy(sq, player)) {
          const key = `${cr},${cc2}`;
          if (alreadyCaptured && alreadyCaptured.has(key)) break;
          foundEnemy = { mr: cr, mc: cc2 };
        } else break;
      } else {
        if (sq === EMPTY) {
          moves.push({ r: cr, c: cc2, capturedSquare: { mr: foundEnemy.mr, mc: foundEnemy.mc } });
        } else break;
      }
      cr += dr; cc2 += dc;
    }
  }
  return moves;
}

export function getMovesForPiece(board, r, c, player, onlyCaptures = false, alreadyCaptured = null) {
  if (isKing(board[r][c])) return getQueenMoves(board, r, c, player, onlyCaptures, alreadyCaptured);
  return getNormalMoves(board, r, c, player, onlyCaptures);
}

export function getCaptureMovesFrom(board, r, c, player, alreadyCaptured) {
  return getMovesForPiece(board, r, c, player, true, alreadyCaptured)
    .filter(m => m.capturedSquare !== null);
}

export function getAllCaptures(board, player) {
  const result = [];
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++)
      if (isOwn(board[r][c], player))
        getCaptureMovesFrom(board, r, c, player, null)
          .forEach(m => result.push({ from: { r, c }, ...m }));
  return result;
}

export function getAllMoves(board, player, mustCapturePos = null) {
  if (mustCapturePos) {
    return getCaptureMovesFrom(board, mustCapturePos.r, mustCapturePos.c, player,
      mustCapturePos.captured || null);
  }
  const caps = getAllCaptures(board, player);
  if (caps.length > 0) return caps;
  const result = [];
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++)
      if (isOwn(board[r][c], player))
        getMovesForPiece(board, r, c, player, false, null)
          .filter(m => !m.capturedSquare)
          .forEach(m => result.push({ from: { r, c }, ...m }));
  return result;
}

export function applyMove(board, from, move) {
  const nb = board.map(row => [...row]);
  const piece = nb[from.r][from.c];
  if (move.capturedSquare) nb[move.capturedSquare.mr][move.capturedSquare.mc] = EMPTY;
  nb[from.r][from.c] = EMPTY;
  nb[move.r][move.c] = piece;
  if (piece === BLACK && move.r === 0) nb[move.r][move.c] = B_KING;
  if (piece === WHITE && move.r === 7) nb[move.r][move.c] = W_KING;
  return nb;
}

function countCaptured(move) { return move.capturedSquare ? 1 : 0; }

/* ══════════════════════════════════════════════════════════════════
   UPGRADED AI ENGINE
   — Rich evaluation  (material + position + king safety + mobility)
   — Move ordering    (captures first → better alpha-beta pruning)
   — Transposition table  (avoid re-evaluating same positions)
   — Iterative deepening  (gets deeper as time allows, always has a move)
   — Web Worker           (runs off main thread — UI never freezes)
   ══════════════════════════════════════════════════════════════════ */

// ── Piece-square tables (WHITE perspective; flip rows for BLACK) ──
// Advancement: men score more as they advance toward promotion
const PST_MAN = [
  [0,  0,  0,  0,  0,  0,  0,  0],  // row 0 — promotion row for WHITE
  [5,  0,  5,  0,  5,  0,  5,  0],
  [0,  4,  0,  4,  0,  4,  0,  4],
  [3,  0,  3,  0,  3,  0,  3,  0],
  [0,  3,  0,  4,  0,  4,  0,  3],  // center bonus
  [2,  0,  3,  0,  3,  0,  2,  0],  // center bonus
  [0,  2,  0,  2,  0,  2,  0,  2],
  [1,  0,  1,  0,  1,  0,  1,  0],  // starting row
];

// Kings want to be central and active
const PST_KING = [
  [-2, -1, -2, -1, -2, -1, -2, -1],
  [-1,  1, -1,  2, -1,  2, -1, -1],
  [-2,  2,  3,  4,  4,  3,  2, -2],
  [-1,  2,  4,  5,  5,  4,  2, -1],
  [-1,  2,  4,  5,  5,  4,  2, -1],
  [-2,  2,  3,  4,  4,  3,  2, -2],
  [-1,  1, -1,  2, -1,  2, -1, -1],
  [-2, -1, -2, -1, -2, -1, -2, -1],
];

function evaluate(board, aiPlayer) {
  const opp = aiPlayer === BLACK ? WHITE : BLACK;
  let score = 0;

  let aiPieces = 0, oppPieces = 0;
  let aiKings  = 0, oppKings  = 0;
  let aiBackRow = 0, oppBackRow = 0;

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p === EMPTY) continue;

      const king = isKing(p);
      const mine = isOwn(p, aiPlayer);

      // Material: man=100, king=320
      const matVal = king ? 320 : 100;

      // Piece-square table bonus
      let pstVal;
      if (king) {
        pstVal = PST_KING[r][c] * 4;
      } else {
        const isPieceBlack = (p === BLACK || p === B_KING);
        const pstRow = isPieceBlack ? r : (7 - r);
        pstVal = PST_MAN[pstRow][c] * 3;
      }

      // Back-rank defence bonus (uncrowned men protecting promotion row)
      if (!king) {
        if (mine && ((aiPlayer === WHITE && r === 0) || (aiPlayer === BLACK && r === 7))) aiBackRow++;
        if (!mine && ((aiPlayer === WHITE && r === 7) || (aiPlayer === BLACK && r === 0))) oppBackRow++;
      }

      if (mine) {
        score += matVal + pstVal;
        if (king) aiKings++; else aiPieces++;
      } else {
        score -= matVal + pstVal;
        if (king) oppKings++; else oppPieces++;
      }
    }
  }

  const aiTotal  = aiPieces  + aiKings;
  const oppTotal = oppPieces + oppKings;

  // Mobility: more moves = better (stronger weight)
  const aiMoves  = getAllMoves(board, aiPlayer).length;
  const oppMoves = getAllMoves(board, opp).length;
  score += (aiMoves - oppMoves) * 5;

  // Safety: reward keeping pieces on the back rank
  score += (aiBackRow - oppBackRow) * 10;

  // Threat bonus: reward positions where AI can capture next move
  const aiCaptures  = getAllCaptures(board, aiPlayer).length;
  const oppCaptures = getAllCaptures(board, opp).length;
  score += (aiCaptures - oppCaptures) * 15;

  // Endgame: when AI is ahead and opponent is running out of pieces
  if (aiTotal > oppTotal) {
    score += (aiTotal - oppTotal) * 20;
    // Prefer kings over men when winning
    score += aiKings * 30;
  }

  // Lone king penalty: if AI has only 1 king left and opp has many pieces, that's bad
  if (aiTotal === 1 && aiKings === 1 && oppTotal >= 3) score -= 200;

  return score;
}

// ── Transposition table ──────────────────────────────────────────
const TT_SIZE  = 1 << 21;   // 2 097 152 slots (larger TT = less re-work at depth)
const ttTable  = new Array(TT_SIZE);
const TT_EXACT = 0, TT_LOWER = 1, TT_UPPER = 2;

function boardHash(board) {
  let h = 0;
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++)
      h = (Math.imul(h, 31) + board[r][c]) | 0;
  return h;
}

function ttGet(hash, depth, alpha, beta) {
  const slot = ttTable[(hash >>> 0) % TT_SIZE];
  if (!slot || slot.hash !== hash || slot.depth < depth) return null;
  if (slot.flag === TT_EXACT)                        return slot.score;
  if (slot.flag === TT_LOWER && slot.score >= beta)  return slot.score;
  if (slot.flag === TT_UPPER && slot.score <= alpha) return slot.score;
  return null;
}

function ttPut(hash, depth, score, flag) {
  const idx = (hash >>> 0) % TT_SIZE;
  const old = ttTable[idx];
  if (!old || old.depth <= depth)
    ttTable[idx] = { hash, depth, score, flag };
}

// ── Move ordering: captures first, then king moves, then normal ──
function orderMoves(moves, board) {
  return moves.slice().sort((a, b) => {
    const aCapture = a.capturedSquare ? 1 : 0;
    const bCapture = b.capturedSquare ? 1 : 0;
    if (aCapture !== bCapture) return bCapture - aCapture;
    const aKing = isKing(board[(a.from||a).r]?.[(a.from||a).c] ?? EMPTY) ? 1 : 0;
    const bKing = isKing(board[(b.from||b).r]?.[(b.from||b).c] ?? EMPTY) ? 1 : 0;
    return bKing - aKing;
  });
}

// ── Alpha-beta with transposition table ─────────────────────────
function alphaBeta(board, depth, alpha, beta, maximizing, aiPlayer) {
  const hash = boardHash(board);
  const cached = ttGet(hash, depth, alpha, beta);
  if (cached !== null) return cached;

  const player = maximizing ? aiPlayer : (aiPlayer === BLACK ? WHITE : BLACK);
  const moves  = getAllMoves(board, player);

  if (moves.length === 0) {
    const score = maximizing ? -20000 - depth : 20000 + depth;
    ttPut(hash, depth, score, TT_EXACT);
    return score;
  }

  if (depth === 0) {
    const score = evaluate(board, aiPlayer);
    ttPut(hash, depth, score, TT_EXACT);
    return score;
  }

  const ordered = orderMoves(moves, board);
  const origAlpha = alpha;
  let best = maximizing ? -Infinity : Infinity;

  for (const m of ordered) {
    const from = m.from || { r: m.r, c: m.c };
    const nb   = applyMove(board, from, m);
    const val  = alphaBeta(nb, depth - 1, alpha, beta, !maximizing, aiPlayer);

    if (maximizing) {
      if (val > best) best = val;
      if (val > alpha) alpha = val;
    } else {
      if (val < best) best = val;
      if (val < beta) beta = val;
    }
    if (beta <= alpha) break;
  }

  const flag = best <= origAlpha ? TT_UPPER : best >= beta ? TT_LOWER : TT_EXACT;
  ttPut(hash, depth, best, flag);
  return best;
}

// ── Iterative deepening ──────────────────────────────────────────
export function getBestAIMove(board, aiPlayer, difficulty) {
  // Clear the transposition table for each new move request to prevent stale evaluation values and collisions
  ttTable.fill(undefined);

  let maxDepth, timeBudget, randomChance;

  if (typeof difficulty === 'number') {
    const pct = Math.max(1, Math.min(100, difficulty));
    // ── Difficulty tiers ───────────────────────────────────────────────
    // pct  1-20  Very Easy : pure random 90% of the time, shallow search
    // pct 21-40  Easy      : 60% random, depth 3, fast budget
    // pct 41-60  Normal    : 10% random, depth 5, 500ms
    // pct 61-80  Hard      : full search, depth 7, 1 200ms
    // pct 81-90  Very Hard : full search, depth 10, 2 500ms
    // pct 91-100 Max       : full search, depth 14, 4 000ms (as deep as time allows)
    if      (pct <= 20) { maxDepth =  2; timeBudget =  150; randomChance = 0.90; }
    else if (pct <= 40) { maxDepth =  3; timeBudget =  250; randomChance = 0.60; }
    else if (pct <= 60) { maxDepth =  5; timeBudget =  500; randomChance = 0.10; }
    else if (pct <= 80) { maxDepth =  7; timeBudget = 1200; randomChance = 0.00; }
    else if (pct <= 90) { maxDepth = 10; timeBudget = 2500; randomChance = 0.00; }
    else                { maxDepth = 14; timeBudget = 4000; randomChance = 0.00; }
  } else {
    // legacy string fallback
    if (difficulty === 'easy')      { maxDepth = 3;  timeBudget = 250;  randomChance = 0.60; }
    else if (difficulty === 'hard') { maxDepth = 7;  timeBudget = 1200; randomChance = 0.00; }
    else                            { maxDepth = 5;  timeBudget = 500;  randomChance = 0.10; }
  }

  const moves = getAllMoves(board, aiPlayer, null);
  if (moves.length === 0) return null;
  if (moves.length === 1) return moves[0];  // forced move — no need to search

  // Random injection for lower tiers
  if (randomChance > 0 && Math.random() < randomChance) {
    return moves[Math.floor(Math.random() * moves.length)];
  }

  // ── Iterative deepening with time limit ──────────────────────
  const ordered  = orderMoves(moves, board);
  const deadline = Date.now() + timeBudget;
  let bestMove   = ordered[0];

  for (let depth = 1; depth <= maxDepth; depth++) {
    // Stop if not enough time left to meaningfully search another ply
    if (Date.now() >= deadline) break;

    let depthBest = -Infinity;
    let depthMove = ordered[0];
    let timedOut  = false;

    for (const m of ordered) {
      if (Date.now() >= deadline) { timedOut = true; break; }
      const from  = m.from || { r: m.r, c: m.c };
      const nb    = applyMove(board, from, m);
      const score = alphaBeta(nb, depth - 1, -Infinity, Infinity, false, aiPlayer);
      if (score > depthBest) { depthBest = score; depthMove = m; }
    }

    // Only commit result if we completed the full depth without timing out mid-search
    if (!timedOut) bestMove = depthMove;
    if (Date.now() >= deadline) break;
  }

  return bestMove;
}

/* ── Board rendering ── */
export function renderBoard() {
  const el = document.getElementById('gameBoard');
  if (!el) return;
  el.innerHTML = '';

  const highlights = new Set(G.validMoves.map(m => `${m.r},${m.c}`));
  const mustSet = new Set();
  if (!G.mustCapture)
    getAllCaptures(G.board, G.turn).forEach(m => mustSet.add(`${m.from.r},${m.from.c}`));

  // Flip board when local player is WHITE so their pieces always appear at the bottom
  const flipped = G.isOnlinePvP && G.myColor === 'white';
  const rowOrder = flipped
    ? [7,6,5,4,3,2,1,0]
    : [0,1,2,3,4,5,6,7];
  const colOrder = flipped
    ? [7,6,5,4,3,2,1,0]
    : [0,1,2,3,4,5,6,7];

  // Also flip the board coordinate labels
  const boardWrap = document.querySelector('.game-board-wrap');
  if (boardWrap) {
    boardWrap.classList.toggle('board-flipped', flipped);
  }

  for (const r of rowOrder) {
    for (const c of colOrder) {
      const cell   = document.createElement('div');
      const isDark = (r + c) % 2 !== 0;
      cell.className = 'gc ' + (isDark ? 'gd' : 'gl');
      cell.dataset.r = r;
      cell.dataset.c = c;
      if (!isDark) { el.appendChild(cell); continue; }

      const piece      = G.board[r][c];
      const isSelected = G.selected && G.selected.r === r && G.selected.c === c;
      const isLocked   = G.mustCapture && G.mustCapture.r === r && G.mustCapture.c === c;
      const isHigh     = highlights.has(`${r},${c}`);

      if (isSelected || isLocked) cell.classList.add('gc-selected');
      if (isHigh)                  cell.classList.add('gc-highlight');

      if (piece !== EMPTY) {
        const pd   = document.createElement('div');
        const isB  = piece === BLACK || piece === B_KING;
        const king = isKing(piece);
        const shapeClass = isB ? (window.pieceShapeClass || 'gp-shape-disc') : 'gp-shape-disc';
        pd.className = 'gp ' + (isB ? 'gp-b' : 'gp-w') + (king ? ' gp-king' : '') + ' ' + shapeClass;
        if (mustSet.has(`${r},${c}`) && isOwn(piece, G.turn)) pd.classList.add('gp-must');
        if (isSelected || isLocked) pd.classList.add('gp-sel');
        if (isLocked) pd.classList.add('gp-locked');
        if (isHigh)   cell.classList.add('gc-highlight-piece');

        if (king) {
          pd.innerHTML = buildQueenInner(isB);
        } else if (shapeClass === 'gp-shape-pawn' && isB) {
          const t = window.pieceTheme || {};
          pd.innerHTML = buildPawnPieceSVG(
            t.c1 || '#555', t.c2 || '#222', t.border || 'rgba(255,255,255,.1)'
          );
        } else if (G.sameTheme) {
          const tag = document.createElement('span');
          tag.className = 'gp-player-tag';
          tag.textContent = isB ? 'P1' : 'P2';
          pd.appendChild(tag);
        }

        cell.appendChild(pd);
      }

      cell.addEventListener('click', () => onCellClick(r, c));
      el.appendChild(cell);
    }
  }
}

function onCellClick(r, c) {
  if (G.gameOver) return;
  if (G.mode === 'ai' && G.turn === WHITE) return;
  if (G.isOnlinePvP) {
    const myPlayerColor = G.myColor === 'black' ? BLACK : WHITE;
    if (G.turn !== myPlayerColor) {
      setStatus("⚠ It is your opponent's turn!");
      return;
    }
  }
  if ((r + c) % 2 === 0) return;

  const piece = G.board[r][c];

  if (G.mustCapture) {
    const move = G.validMoves.find(m => m.r === r && m.c === c);
    if (move) executeMove(G.mustCapture, move);
    return;
  }

  if (G.selected) {
    const move = G.validMoves.find(m => m.r === r && m.c === c);
    if (move) { executeMove(G.selected, move); return; }
  }

  if (isOwn(piece, G.turn)) {
    const allCaps = getAllCaptures(G.board, G.turn);
    if (allCaps.length > 0) {
      const canCapture = getCaptureMovesFrom(G.board, r, c, G.turn, null).length > 0;
      if (!canCapture) {
        setStatus('⚠ You must capture! Select a piece that can capture.');
        return;
      }
    }
    selectPiece(r, c);
    return;
  }

  G.selected   = null;
  G.validMoves = [];
  renderBoard();
}

function selectPiece(r, c) {
  G.selected = { r, c };
  const allCaps = getAllCaptures(G.board, G.turn);
  if (allCaps.length > 0) {
    G.validMoves = getCaptureMovesFrom(G.board, r, c, G.turn, G.chainCaptured || null);
  } else {
    G.validMoves = getMovesForPiece(G.board, r, c, G.turn, false, null)
      .filter(m => !m.capturedSquare);
  }
  renderBoard();
  setStatus(G.validMoves.length > 0 ? 'Choose a square to move' : 'No valid moves from here');
}

/* ── Execute one move step ── */
export function executeMove(from, move, isRemote = false) {
  // Player made a move — stop the countdown and reset idle timer
  stopCountdown();
  if (typeof window.resetIdle === 'function') window.resetIdle();
  if (G.isOnlinePvP && !isRemote) {
    window.Socket?.send('make_move', {
      gameId: G.gameId,
      playerId: window.tgUserId,
      from,
      move
    });
  }

  const caps = countCaptured(move);
  tgHaptic(caps > 0 ? 'success' : 'light');

  // If the piece being captured was the tracked lone king — reset counter
  if (caps > 0 && G.soloKingPlayer !== null) {
    const opp = G.turn === BLACK ? WHITE : BLACK;
    if (G.soloKingPlayer === opp) {
      // Check if the captured square was the lone king
      const cs = move.capturedSquare;
      if (cs && isKing(G.board[cs.mr][cs.mc])) {
        G.soloKingPlayer = null;
        G.soloKingMoves  = 0;
      }
    }
  }

  if (!G.mustCapture) {
    G.history.push({
      board:          G.board.map(row => [...row]),
      turn:           G.turn,
      captured:       { ...G.captured },
      moveCount:      G.moveCount,
      mustCapture:    null,
      chainCaptured:  null,
      timers:         { ...G.timers },
      soloKingPlayer: G.soloKingPlayer,
      soloKingMoves:  G.soloKingMoves,
    });
  }

  const wasKingBefore = isKing(G.board[from.r][from.c]);
  animatePieceMove(from);
  G.board = applyMove(G.board, from, move);
  G.captured[G.turn] += caps;
  G.moveCount++;

  if (move.capturedSquare) {
    const cells = document.querySelectorAll('.gc');
    const cc = cells[move.capturedSquare.mr * 8 + move.capturedSquare.mc];
    if (cc) { cc.classList.add('gc-captured'); setTimeout(() => cc.classList.remove('gc-captured'), 500); }
  }

  const landed       = G.board[move.r][move.c];
  const justPromoted = !wasKingBefore && isKing(landed);

  if (!G.chainCaptured) G.chainCaptured = new Set();
  if (move.capturedSquare) G.chainCaptured.add(`${move.capturedSquare.mr},${move.capturedSquare.mc}`);

  if (caps > 0 && !justPromoted) {
    const moreCaps = getCaptureMovesFrom(G.board, move.r, move.c, G.turn, G.chainCaptured);
    if (moreCaps.length > 0) {
      G.mustCapture = { r: move.r, c: move.c };
      G.selected    = { r: move.r, c: move.c };
      G.validMoves  = moreCaps;
      updatePanels(); renderBoard();
      if (G.mode === 'ai' && G.turn === WHITE) {
        setStatus(`🤖 ${G.opponent ? G.opponent.name : 'AI'} continues capturing…`);
        setTimeout(doAIMove, G.aiThinkDelay ?? 500);
      } else {
        setStatus('⚡ Continue capturing! Choose next square.');
      }
      return;
    }
  }

  G.mustCapture   = null;
  G.chainCaptured = null;
  G.selected      = null;
  G.validMoves    = [];
  updatePanels(); renderBoard();
  if (checkWin()) return;
  if (checkSoloKingRule(G.turn)) return;
  switchTurn();
}

function switchTurn() {
  G.turn = G.turn === BLACK ? WHITE : BLACK;
  if (G.debug) console.log('[switchTurn] New turn:', G.turn === BLACK ? 'BLACK' : 'WHITE', 'Mode:', G.mode);
  updateTurnIndicator();
  const moves = getAllMoves(G.board, G.turn);
  if (moves.length === 0) { endGame(G.turn === BLACK ? WHITE : BLACK, 'No moves available'); return; }

  // If solo-king rule is active, remind both players of the count
  if (G.soloKingPlayer !== null) {
    const playerName = G.soloKingPlayer === BLACK
      ? document.getElementById('p1name').textContent
      : document.getElementById('p2name').textContent;
    const remaining = G.SOLO_KING_LIMIT - G.soloKingMoves;
    setStatus(`⚠ Lone king rule: ${G.soloKingMoves}/${G.SOLO_KING_LIMIT} — ${remaining} moves left`);
  } else {
    setStatus(G.mode === 'ai' && G.turn === WHITE ? `🤖 ${G.opponent ? G.opponent.name : 'AI'} is thinking…` : turnMsg());
  }

  startCountdown();
  if (G.debug) console.log('[switchTurn] Scheduling AI move?', G.mode === 'ai' && G.turn === WHITE);
  if (G.mode === 'ai' && G.turn === WHITE) setTimeout(doAIMove, G.aiThinkDelay ?? 600);
}

let _aiWorkerBusy = false;

/* ── Resolve the backend API base URL ─────────────────────────── */
function _apiBase() {
  return window._socketRef?.apiUrl || window.Socket?.apiUrl || '';
}

/* ── Ask the Gemini-backed endpoint for the best move ─────────── */
async function _fetchLLMMove(moves) {
  const apiToken = window.DAMA_API_TOKEN || localStorage.getItem('dama_api_token') || '';
  const res = await fetch(`${_apiBase()}/ai/move`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiToken ? { 'X-API-Token': apiToken } : {}),
    },
    body: JSON.stringify({
      board:     G.board,
      moves,
      aiPlayer:  WHITE,
      difficulty: G.difficulty,
    }),
    signal: AbortSignal.timeout(10000), // give Gemini up to 10 s
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return json.data; // { move } | { fallback: true, reason }
}

function doAIMove() {
  if (G.debug) console.log('[doAIMove] Started, turn:', G.turn === BLACK ? 'BLACK' : 'WHITE');
  if (G.gameOver) {
    if (G.debug) console.log('[doAIMove] Game over, abort');
    return;
  }

  // ── Chain capture: AI must continue capturing (no LLM needed) ──
  if (G.mustCapture) {
    if (G.debug) console.log('[doAIMove] Continuing chain capture');
    const caps = getCaptureMovesFrom(G.board, G.mustCapture.r, G.mustCapture.c, WHITE, G.chainCaptured);
    if (caps.length === 0) {
      if (G.debug) console.log('[doAIMove] No capture moves left, ending chain');
      G.mustCapture = null; G.chainCaptured = null; G.selected = null; G.validMoves = [];
      updatePanels(); renderBoard();
      if (checkWin()) return;
      switchTurn();
      return;
    }
    // Use LLM for chain-capture choice as well — fall through to normal path
    // by NOT returning here; instead set mustCapture context and continue below
    // Actually for chain captures we keep it instant to not delay the game:
    executeMove(G.mustCapture, caps[Math.floor(Math.random() * caps.length)]);
    if (G.debug) console.log('[doAIMove] Executed chain capture move');
    return;
  }

  // ── Guard against double-trigger ──────────────────────────────
  if (_aiWorkerBusy) {
    if (G.debug) console.log('[doAIMove] Worker busy, abort');
    return;
  }
  _aiWorkerBusy = true;
  if (G.debug) console.log('[doAIMove] Worker set busy, proceeding with AI calculation');

  // ── Tiny delay to let the browser paint "thinking…" first ─────
  setTimeout(async () => {
    if (G.gameOver || G.mode !== 'ai' || G.turn !== WHITE) {
      _aiWorkerBusy = false;
      return;
    }

    // Collect all legal moves now (shared by both LLM and Minimax paths)
    const legalMoves = getAllMoves(G.board, WHITE, null);
    if (!legalMoves || legalMoves.length === 0) {
      _aiWorkerBusy = false;
      endGame(BLACK, 'AI has no moves');
      return;
    }

    let chosenMove = null;

    // ── 1. Try Gemini LLM first ────────────────────────────────
    try {
      const data = await _fetchLLMMove(legalMoves);
      if (data && data.move && !data.fallback) {
        chosenMove = data.move;
        if (G.debug) console.log('[doAIMove] Using LLM move:', chosenMove);
      } else {
        if (G.debug) console.log('[doAIMove] LLM fallback signal received:', data?.reason);
      }
    } catch (llmErr) {
      if (G.debug) console.warn('[doAIMove] LLM request failed, using Minimax:', llmErr.message);
    }

    // ── 2. Fallback: local Minimax ────────────────────────────
    if (!chosenMove) {
      try {
        chosenMove = getBestAIMove(G.board, WHITE, G.difficulty);
        if (G.debug) console.log('[doAIMove] Using Minimax move:', chosenMove);
      } catch (mmErr) {
        console.error('[doAIMove] Minimax error:', mmErr);
      }
    }

    _aiWorkerBusy = false;

    if (!chosenMove) { endGame(BLACK, 'AI has no moves'); return; }
    executeMove(chosenMove.from || { r: chosenMove.r, c: chosenMove.c }, chosenMove);
  }, 50);
}

function checkWin() {
  let blacks = 0, whites = 0;
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++) {
      if (G.board[r][c] === BLACK || G.board[r][c] === B_KING) blacks++;
      if (G.board[r][c] === WHITE || G.board[r][c] === W_KING) whites++;
    }
  if (blacks === 0) { endGame(WHITE, 'All black pieces captured'); return true; }
  if (whites === 0) { endGame(BLACK, 'All white pieces captured'); return true; }
  return false;
}

/* ── Solo-king stalling rule ─────────────────────────────────────────────────
 * Condition: one player has exactly 1 piece AND it is a king,
 *            AND the opponent has ≤ 3 pieces.
 * When active: count that player's moves.
 * If they reach SOLO_KING_LIMIT (10) moves without the king being captured → they LOSE.
 * If the king is captured at any point → reset the counter.
 * ────────────────────────────────────────────────────────────────────────── */
function countPieces(board, player) {
  let count = 0;
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++)
      if (isOwn(board[r][c], player)) count++;
  return count;
}

function hasSoloKing(board, player) {
  let pieces = 0, kings = 0;
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!isOwn(p, player)) continue;
      pieces++;
      if (isKing(p)) kings++;
    }
  return pieces === 1 && kings === 1;
}

function checkSoloKingRule(movingPlayer) {
  if (G.gameOver) return false;

  const opponent = movingPlayer === BLACK ? WHITE : BLACK;
  const opponentCount = countPieces(G.board, opponent);

  // Check if the player who just moved is the lone-king player
  const movedHasSoloKing = hasSoloKing(G.board, movingPlayer);
  const opponentHasFew   = opponentCount <= 3;

  if (movedHasSoloKing && opponentHasFew) {
    // Start or continue tracking this player
    if (G.soloKingPlayer !== movingPlayer) {
      // New lone-king situation — start fresh counter
      G.soloKingPlayer = movingPlayer;
      G.soloKingMoves  = 0;
    }

    G.soloKingMoves++;
    const remaining = G.SOLO_KING_LIMIT - G.soloKingMoves;
    const playerName = movingPlayer === BLACK
      ? document.getElementById('p1name').textContent
      : document.getElementById('p2name').textContent;

    if (G.soloKingMoves >= G.SOLO_KING_LIMIT) {
      // Lone king failed to escape in 10 moves → loses
      const winner = opponent;
      endGame(winner, `${playerName}'s lone king failed to escape in ${G.SOLO_KING_LIMIT} moves`);
      return true;
    }

    // Warn the player
    setStatus(`⚠ Lone king: ${G.soloKingMoves}/${G.SOLO_KING_LIMIT} moves used — must escape!`);

  } else {
    // Condition no longer applies — reset if it was tracking this player
    if (G.soloKingPlayer === movingPlayer) {
      G.soloKingPlayer = null;
      G.soloKingMoves  = 0;
    }
    // Also reset if the lone king was captured (opponent now has solo king or neither)
    if (G.soloKingPlayer !== null && !hasSoloKing(G.board, G.soloKingPlayer)) {
      G.soloKingPlayer = null;
      G.soloKingMoves  = 0;
    }
  }

  return false;
}

export function endGame(winner, reason, isRemote = false, settlement = null) {
  G.gameOver = true;
  clearInterval(G.timerInterval);
  stopCountdown();
  // Hide countdown UI
  ['cd-turn-1','cd-turn-2'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  document.getElementById('panel1')?.classList.remove('ss-danger');
  document.getElementById('panel2')?.classList.remove('ss-danger');
  const myId  = window.tgUserId;
  const oppId = G.opponent?.id;

  if (G.isOnlinePvP && !isRemote) {
    // Send from whichever side detects the end (not just black)
    const myColor = G.myColor === 'black' ? BLACK : WHITE;
    const winnerId = winner === BLACK ? (myColor === BLACK ? myId : oppId)
                   : winner === WHITE ? (myColor === WHITE ? myId : oppId)
                   : null;
    window.Socket?.send('game_over', {
      gameId: G.gameId,
      winnerId,
      reason,
      durationSec: Math.floor((Date.now() - G.startTime) / 1000),
      moveCount: G.moveCount
    });
  }

  // ── Save result to backend DB for ALL game modes ─────────────────────────
  if (myId && !isRemote) {
    // Determine result from local player's perspective
    let result;
    if (winner === null || winner === undefined) result = 'draw';
    else if (winner === BLACK) result = 'win';   // BLACK = player 1 = me in AI/local
    else result = 'loss';

    // For online PvP, server handles this via WS — only save locally for AI/local
    if (!G.isOnlinePvP) {
      const durationSec = Math.floor((Date.now() - G.startTime) / 1000);
      const { apiUrl } = window._socketRef || {};
      const apiToken = window.DAMA_API_TOKEN || localStorage.getItem('dama_api_token') || '';
      const betAmount = G.betAmount || window.currentBet || 0;

      // ── AI game WITH a real bet → use finish-ai-bet for full settlement ──
      if (G.mode === 'ai' && betAmount > 0 && G.gameId && myId && oppId) {
        const endpoint = (apiUrl || window.Socket?.apiUrl || '') + '/games/finish-ai-bet';
        let aiResult;
        if (winner === null || winner === undefined) aiResult = 'draw';
        else aiResult = winner === BLACK ? 'win' : 'loss'; // BLACK = human player

        fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-API-Token': apiToken },
          body: JSON.stringify({
            gameId:     G.gameId,
            humanId:    myId,
            aiId:       oppId,
            result:     aiResult,
            durationSec,
            moveCount:  G.moveCount,
          }),
        }).then(async res => {
          if (res.ok) {
            const json = await res.json();
            const s = json?.data?.settlement;
            // Patch the win modal with the server-confirmed payout
            if (s && typeof s.winnerPayout === 'number') {
              const prizeEl = document.getElementById('ms-prize');
              if (prizeEl && aiResult === 'win') {
                prizeEl.textContent = s.winnerPayout.toLocaleString();
              }
            }
            // Refresh player stats
            setTimeout(() => {
              window.PlayerRegistry?.fetchPlayers?.().then(() => {
                if (typeof window.renderPlayerList === 'function') window.renderPlayerList();
              });
              window.PlayerRegistry?.fetchCurrentPlayer?.(myId);
            }, 300);
          }
        }).catch(() => { /* silent */ });

      } else {
        // ── No-bet game or local PvP → finish-local (stats only) ────────────
        const endpoint = (apiUrl || window.Socket?.apiUrl || '') + '/games/finish-local';

        let localResult;
        if (winner === null || winner === undefined) localResult = 'draw';
        else if (G.mode === 'ai') {
          localResult = winner === BLACK ? 'win' : 'loss';
        } else {
          localResult = winner === BLACK ? 'win' : 'loss';
        }

        let winnerDbId = null;
        if (winner === BLACK) winnerDbId = myId;
        else if (winner === WHITE && oppId) winnerDbId = oppId;

        fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-API-Token': apiToken },
          body: JSON.stringify({
            mode:        G.mode,
            player1Id:   myId,
            player2Id:   oppId || null,
            winnerId:    winnerDbId,
            result:      localResult,
            durationSec,
            moveCount:   G.moveCount,
          }),
        }).then(res => {
          if (res.ok) {
            setTimeout(() => {
              window.PlayerRegistry?.fetchPlayers?.().then(() => {
                if (typeof window.renderPlayerList === 'function') window.renderPlayerList();
              });
            }, 300);
          }
        }).catch(() => { /* silent */ });
      }
    }
  }

  if (myId && window.PlayerRegistry) {
    if      (winner === BLACK) { window.PlayerRegistry.recordResult(myId, 'win');  if (oppId) window.PlayerRegistry.recordResult(oppId, 'loss'); }
    else if (winner === WHITE) { window.PlayerRegistry.recordResult(myId, 'loss'); if (oppId) window.PlayerRegistry.recordResult(oppId, 'win');  }
    else                       { window.PlayerRegistry.recordResult(myId, 'draw'); if (oppId) window.PlayerRegistry.recordResult(oppId, 'draw'); }

    // Sync from backend after a short delay so DB has been updated
    setTimeout(() => {
      window.PlayerRegistry.fetchPlayers().then(() => {
        if (typeof window.renderPlayerList === 'function') window.renderPlayerList();
      });
    }, 800);
  }
  const wName = winner === BLACK
    ? document.getElementById('p1name').textContent
    : document.getElementById('p2name').textContent;

  // Determine if the local player (viewer) actually won
  let iLocalWin = false;
  if (winner !== null && winner !== undefined) {
    if (G.isOnlinePvP) {
      const myColor = G.myColor === 'black' ? BLACK : WHITE;
      iLocalWin = (winner === myColor);
    } else {
      // AI / local PvP: BLACK = player 1 = me
      iLocalWin = (winner === BLACK);
    }
  }

  const betAmt = G.betAmount || window.currentBet || 0;
  // Use server-confirmed winnerPayout when available (accurate after fee deduction).
  // For PvP: settlement arrives via WS game_over message.
  // For AI: settlement arrives via finish-ai-bet REST response.
  // Fallback: compute locally (bet * 2 * 0.9) — 10% fee estimate.
  let winnerPayout = 0;
  if (settlement && typeof settlement.winnerPayout === 'number') {
    winnerPayout = settlement.winnerPayout;
  } else if (betAmt > 0) {
    // Estimate: pot minus 10% fee
    winnerPayout = Math.round(betAmt * 2 * 0.9);
  }
  setTimeout(() => showWinModal(wName, reason, iLocalWin, betAmt, winnerPayout), 400);
}

/* ── UI helpers ── */
function setStatus(msg) {
  const el = document.getElementById('gameStatus');
  if (el) el.textContent = msg;
}

function turnMsg() {
  if (G.mode === 'pvp') {
    const name = G.turn === BLACK
      ? document.getElementById('p1name').textContent
      : document.getElementById('p2name').textContent;
    return `${name}'s turn`;
  }
  if (G.turn === BLACK) return 'Your turn';
  const oppName = G.opponent ? G.opponent.name : 'AI';
  return `🤖 ${oppName} is thinking…`;
}

function updateTurnIndicator() {
  const t1 = document.getElementById('p1turn');
  const t2 = document.getElementById('p2turn');
  if (!t1 || !t2) return;
  t1.classList.toggle('hidden', G.turn !== BLACK);
  t2.classList.toggle('hidden', G.turn !== WHITE);
  document.getElementById('panel1')?.classList.toggle('ss-active', G.turn === BLACK);
  document.getElementById('panel2')?.classList.toggle('ss-active', G.turn === WHITE);

  // Dynamic turn pill labels to avoid user confusion
  const iAmBlack = !G.isOnlinePvP || G.myColor === 'black';
  const myTurnEl = iAmBlack ? t1 : t2;
  const oppTurnEl = iAmBlack ? t2 : t1;

  if (myTurnEl) {
    myTurnEl.textContent = 'YOUR TURN';
  }
  if (oppTurnEl) {
    if (G.mode === 'ai') {
      oppTurnEl.textContent = 'AI\'S TURN';
    } else {
      oppTurnEl.textContent = 'THEIR TURN';
    }
  }
}

function updatePanels() {
  document.getElementById('p1score').textContent = G.captured[BLACK];
  document.getElementById('p2score').textContent = G.captured[WHITE];
  renderCapturedPieces();
}

function renderCapturedPieces() {
  ['p1captured','p2captured'].forEach((id, i) => {
    const player = i === 0 ? BLACK : WHITE;
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = '';
    for (let k = 0; k < G.captured[player]; k++) {
      const dot = document.createElement('div');
      dot.className = 'cap-dot ' + (player === BLACK ? 'cap-w' : 'cap-b');
      el.appendChild(dot);
    }
  });
}

/* ── Timer ── */
function startTimer() {
  G.lastTick = Date.now();
  G.timerInterval = setInterval(() => {
    const now = Date.now();
    const dt  = (now - G.lastTick) / 1000;
    G.lastTick = now;
    if (!G.gameOver) {
      G.timers[G.turn] = (G.timers[G.turn] || 0) + dt;
      const el = G.turn === BLACK ? document.getElementById('p1timer') : document.getElementById('p2timer');
      if (el) el.textContent = formatTime(G.timers[G.turn]);
    }
  }, 500);
}

function formatTime(s) {
  const m   = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return String(m).padStart(2,'0') + ':' + String(sec).padStart(2,'0');
}

/* ── Turn countdown (20s per turn) ── */
function stopCountdown() {
  if (G.countdownInterval) {
    clearInterval(G.countdownInterval);
    G.countdownInterval = null;
  }
}

function updateCountdownUI() {
  const secs = Math.ceil(G.countdown);
  const isBlackTurn = G.turn === BLACK;
  const urgent = secs <= 5;

  // Show the SAME countdown on BOTH panels always
  const el1 = document.getElementById('cd-turn-1');
  const el2 = document.getElementById('cd-turn-2');

  [el1, el2].forEach(el => {
    if (!el) return;
    el.textContent = secs;
    el.className   = 'cd-turn' + (urgent ? ' cd-urgent' : '');
    el.style.display = 'flex';
  });

  // Panel danger highlight ≤5s on the ACTIVE player's panel only
  document.getElementById('panel1')?.classList.toggle('ss-danger', isBlackTurn && urgent);
  document.getElementById('panel2')?.classList.toggle('ss-danger', !isBlackTurn && urgent);

  // Update strike dots for both players
  updateStrikeDots(BLACK, G.strikes[BLACK] || 0);
  updateStrikeDots(WHITE, G.strikes[WHITE] || 0);
}

function updateStrikeDots(player, count) {
  const prefix = player === BLACK ? 'p1s' : 'p2s';
  for (let i = 1; i <= 3; i++) {
    const dot = document.getElementById(prefix + i);
    if (dot) dot.classList.toggle('filled', i <= count);
  }
}

function startCountdown() {
  stopCountdown();
  // AI turn: no countdown
  if (G.mode === 'ai' && G.turn === WHITE) return;

  G.countdown = G.TURN_SECONDS;
  updateCountdownUI();

  G.countdownInterval = setInterval(() => {
    if (G.gameOver) { stopCountdown(); return; }

    G.countdown -= 1;
    updateCountdownUI();

    if (G.countdown <= 0) {
      stopCountdown();
      onTurnTimeout();
    }
  }, 1000);
}

function onTurnTimeout() {
  if (G.gameOver) return;

  const timedOutPlayer = G.turn;
  G.strikes[timedOutPlayer] = (G.strikes[timedOutPlayer] || 0) + 1;
  const strikes = G.strikes[timedOutPlayer];
  const playerName = timedOutPlayer === BLACK
    ? document.getElementById('p1name').textContent
    : document.getElementById('p2name').textContent;

  tgHaptic('warning');

  if (strikes >= G.MAX_STRIKES) {
    // 3 strikes — opponent wins
    const winner = timedOutPlayer === BLACK ? WHITE : BLACK;
    const winnerName = winner === BLACK
      ? document.getElementById('p1name').textContent
      : document.getElementById('p2name').textContent;
    endGame(winner, `${playerName} timed out 3 times`);
  } else {
    // Show warning and pass turn
    setStatus(`⏱ ${playerName} timed out! (${strikes}/${G.MAX_STRIKES} strikes) — turn passed`);
    // Flash the status bar
    const statusEl = document.getElementById('gameStatus');
    if (statusEl) {
      statusEl.style.color = '#e74c3c';
      setTimeout(() => { statusEl.style.color = ''; }, 1500);
    }
    // Cancel any selection
    G.selected   = null;
    G.validMoves = [];
    G.mustCapture = null;
    G.chainCaptured = null;
    renderBoard();
    // Pass to next player
    switchTurn();
  }
}

/* ── Win modal ── */
function showWinModal(name, reason, iLocalWin = false, betAmt = 0, winnerPayout = 0) {
  document.getElementById('winTitle').textContent = name + ' Wins!';
  document.getElementById('winSub').textContent   = reason + '. Well played!';
  document.getElementById('ms-moves').textContent = G.moveCount;
  document.getElementById('ms-time').textContent  = formatTime((G.timers[BLACK]||0) + (G.timers[WHITE]||0));
  document.getElementById('ms-captured').textContent = G.captured[BLACK] + G.captured[WHITE];

  // Show win prize amount only when the local player won and there was a bet
  // winnerPayout is pot − 10% fee (e.g. bet=10 → pot=20 → payout=18)
  const prizeWrap = document.getElementById('ms-prize-wrap');
  const prizeEl   = document.getElementById('ms-prize');
  if (prizeWrap && prizeEl) {
    const prize = winnerPayout > 0 ? winnerPayout : (betAmt > 0 ? Math.round(betAmt * 2 * 0.9) : 0);
    if (iLocalWin && prize > 0) {
      prizeEl.textContent = prize.toLocaleString();
      prizeWrap.classList.remove('hidden');
    } else {
      prizeWrap.classList.add('hidden');
    }
  }

  const modal = document.getElementById('winModal');
  modal.classList.remove('hidden');
  requestAnimationFrame(() => modal.classList.add('modal-show'));

  // ── Auto-return to menu after 10s if no interaction ──────────────────────
  let remaining = 10;

  // Show countdown in the play-again button label
  const playAgainBtn = document.getElementById('playAgainBtn');
  const menuBtn      = document.getElementById('menuBtn2');
  const originalLabel = playAgainBtn?.innerHTML || '';

  function updateAutoLabel() {
    if (playAgainBtn) {
      playAgainBtn.innerHTML = `<span>↺</span> Play Again <span style="opacity:.6;font-size:.8em;">(${remaining}s)</span>`;
    }
  }
  updateAutoLabel();

  // Cancel auto-redirect when user clicks either button
  function cancelAuto() {
    clearInterval(autoTimer);
    if (playAgainBtn) playAgainBtn.innerHTML = originalLabel;
    playAgainBtn?.removeEventListener('click', cancelAuto);
    menuBtn?.removeEventListener('click', cancelAuto);
  }
  playAgainBtn?.addEventListener('click', cancelAuto);
  menuBtn?.addEventListener('click', cancelAuto);

  const autoTimer = setInterval(() => {
    remaining -= 1;
    updateAutoLabel();

    if (remaining <= 0) {
      clearInterval(autoTimer);
      if (playAgainBtn) playAgainBtn.innerHTML = originalLabel;
      // Hide modal and go to menu
      modal.classList.add('hidden');
      modal.classList.remove('modal-show');
      clearInterval(G.timerInterval);
      showScreen('mainMenu');
      if (typeof window.renderPlayerList === 'function') window.renderPlayerList();
    }
  }, 1000);
}

/* ── Undo ── */
export function doUndo() {
  if (G.history.length === 0) return;
  if (G.mode === 'ai' && G.aiAllowUndo === false) return;
  stopCountdown();
  const steps = G.mode === 'ai' ? 2 : 1;
  for (let i = 0; i < steps && G.history.length > 0; i++) {
    const prev          = G.history.pop();
    G.board             = prev.board;
    G.turn              = prev.turn;
    G.captured          = prev.captured;
    G.moveCount         = prev.moveCount;
    G.mustCapture       = prev.mustCapture;
    G.chainCaptured     = prev.chainCaptured;
    G.timers            = prev.timers;
    G.soloKingPlayer    = prev.soloKingPlayer ?? null;
    G.soloKingMoves     = prev.soloKingMoves  ?? 0;
  }
  G.selected   = null;
  G.validMoves = [];
  G.gameOver   = false;
  updatePanels(); updateTurnIndicator(); renderBoard(); setStatus(turnMsg());
  startCountdown();
}

/* ── Apply opponent (WHITE) piece colour separately ── */
function applyOpponentTheme(theme) {
  const root = document.documentElement;
  if (theme) {
    root.style.setProperty('--piece-w1', theme.c1);
    root.style.setProperty('--piece-w2', theme.c2);
    root.style.setProperty('--piece-w3', theme.c3);
    root.style.setProperty('--piece-wBorder', theme.border);
    root.style.setProperty('--piece-wShadow', theme.shadow);
  } else {
    // Classic white
    root.style.setProperty('--piece-w1', '#ffffff');
    root.style.setProperty('--piece-w2', '#e0e0e0');
    root.style.setProperty('--piece-w3', '#b0b0b0');
    root.style.setProperty('--piece-wBorder', 'rgba(0,0,0,.08)');
    root.style.setProperty('--piece-wShadow', 'rgba(255,255,255,.95)');
  }
}

/* ── Queen SVG visual ── */
function buildQueenInner(isBlack) {
  const gold  = '#f0c94a';
  const shine = isBlack ? 'rgba(255,255,255,.25)' : 'rgba(255,255,255,.6)';
  return `
    <svg class="queen-svg" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
      <circle cx="20" cy="20" r="18" fill="none" stroke="${gold}" stroke-width="1.5" opacity=".7"/>
      <rect x="8" y="25" width="24" height="5" rx="2.5" fill="${gold}" opacity=".95"/>
      <polygon points="9,25 12,13 16,22" fill="${gold}" opacity=".95"/>
      <polygon points="17,22 20,9 23,22" fill="${gold}"/>
      <polygon points="24,22 28,13 31,25" fill="${gold}" opacity=".95"/>
      <circle cx="20" cy="20" r="3" fill="${isBlack ? '#fff' : '#2c1b0e'}" opacity=".8"/>
      <ellipse cx="17" cy="15" rx="5" ry="3" fill="${shine}" transform="rotate(-20,17,15)"/>
    </svg>`;
}

/* ── Pawn SVG visual (chess pawn style) ── */
function buildPawnPieceSVG(c1, c2, border) {
  return `<svg viewBox="0 0 40 52" xmlns="http://www.w3.org/2000/svg"
    style="width:100%;height:100%;display:block;">
    <defs>
      <radialGradient id="pg${c1.replace(/[^a-z0-9]/gi,'')}" cx="38%" cy="30%">
        <stop offset="0%" stop-color="${c1}"/>
        <stop offset="100%" stop-color="${c2}"/>
      </radialGradient>
    </defs>
    <rect x="7" y="44" width="26" height="6" rx="3"
      fill="url(#pg${c1.replace(/[^a-z0-9]/gi,'')})" stroke="${border}" stroke-width="1.2"/>
    <rect x="15" y="30" width="10" height="15" rx="4"
      fill="url(#pg${c1.replace(/[^a-z0-9]/gi,'')})" stroke="${border}" stroke-width="1"/>
    <circle cx="20" cy="20" r="11"
      fill="url(#pg${c1.replace(/[^a-z0-9]/gi,'')})" stroke="${border}" stroke-width="1.5"/>
    <ellipse cx="16" cy="16" rx="5" ry="3" fill="rgba(255,255,255,.28)" transform="rotate(-20,16,16)"/>
  </svg>`;
}

/* ── Piece move animation ── */
function animatePieceMove(from) {
  const cells = document.querySelectorAll('.gc');
  const cell  = cells[from.r * 8 + from.c];
  if (!cell) return;
  const piece = cell.querySelector('.gp');
  if (piece) {
    piece.classList.add('gp-moving');
    setTimeout(() => piece.classList.remove('gp-moving'), 300);
  }
}

/* ── Read AI config written by the admin dashboard ── */
function loadAIConfig() {
  try {
    const cfg = JSON.parse(localStorage.getItem('dama_ai_config')) || {};
    return {
      difficulty: cfg.difficulty || 'medium',
      depth:      typeof cfg.depth === 'number' ? cfg.depth : null, // null = use difficulty default
      thinkDelay: typeof cfg.thinkDelay === 'number' ? cfg.thinkDelay : 600,
      aiName:     cfg.aiName     || 'Computer 🤖',
      allowUndo:  cfg.allowUndo  !== false,
    };
  } catch {
    return { difficulty: 'medium', depth: null, thinkDelay: 600, aiName: 'Computer 🤖', allowUndo: true };
  }
}

/* ── startGame (public entry point) ── */
export function startGame(mode, opponentOrNull) {
  if (G.timerInterval) clearInterval(G.timerInterval);
  G = freshState();
  G.mode       = mode;
  // Reset worker busy flag so new game always works
  _aiWorkerBusy = false;

  if (mode === 'pvp' && window.activeOnlineGame) {
    G.isOnlinePvP = true;
    G.myColor     = window.activeOnlineGame.myColor;
    G.gameId      = window.activeOnlineGame.gameId;
    G.betAmount   = window.activeOnlineGame.betAmount;

    // Apply reconnect history moves if they exist
    if (window.activeOnlineGame.history && window.activeOnlineGame.history.length > 0) {
      for (const h of window.activeOnlineGame.history) {
        const m = JSON.parse(h.move_data);
        G.board = applyMove(G.board, m.from, m.move);
        G.moveCount++;
      }
      
      G.turn = window.activeOnlineGame.turn === 'black' ? BLACK : WHITE;

      let blackPieces = 0, whitePieces = 0;
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          const piece = G.board[r][c];
          if (piece === BLACK || piece === B_KING) blackPieces++;
          if (piece === WHITE || piece === W_KING) whitePieces++;
        }
      }
      G.captured[BLACK] = 12 - whitePieces;
      G.captured[WHITE] = 12 - blackPieces;
    }
  } else {
    // AI / local PvP — check if ID was pre-generated for bet verification
    if (window._tempGameId) {
      G.gameId = window._tempGameId;
      window._tempGameId = null; // consume it
    } else {
      const ts   = Date.now().toString(36).toUpperCase();
      const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
      G.gameId   = (mode === 'ai' ? 'AI' : 'LOC') + '-' + ts + '-' + rand;
    }
  }

  // Load AI config from localStorage (set by admin dashboard)
  const aiCfg      = loadAIConfig();
  
  if (mode === 'ai' && opponentOrNull && typeof opponentOrNull === 'object') {
    G.opponent   = opponentOrNull;
    // Use pct from ai_bots table if available, else fall back to legacy difficulty string
    G.difficulty = opponentOrNull.aiPct !== undefined
      ? opponentOrNull.aiPct
      : (opponentOrNull.difficulty || 'medium');
  } else {
    G.opponent   = (mode === 'pvp' && opponentOrNull && typeof opponentOrNull === 'object')
      ? opponentOrNull : null;
    // Use explicit depth if set, otherwise derive from difficulty string
    G.difficulty = mode === 'ai' ? (aiCfg.depth || aiCfg.difficulty) : 'medium';
  }
  
  G.aiThinkDelay   = mode === 'ai' ? aiCfg.thinkDelay : 600;
  G.aiAllowUndo    = mode === 'ai' ? aiCfg.allowUndo  : true;

  const myName  = window.tgUserName || 'Player 1';
  const aiName  = mode === 'ai' ? aiCfg.aiName : 'Player 2';
  const oppName = G.opponent ? G.opponent.name : aiName;

  // ── Always show ME at the bottom panel ───────────────────────────────────
  // In online PvP: if I am WHITE, I'm panel2 (bottom in HTML order) — good.
  // If I am BLACK, I'm panel1 (top in HTML order) — swap visually.
  // In AI / local PvP: player is always BLACK (panel1 = top), so swap to put at bottom.
  const iAmBlack = !G.isOnlinePvP || G.myColor === 'black';
  const gameScreen = document.getElementById('gameScreen');
  if (iAmBlack) {
    // I am BLACK (panel1) — set me-is-top so CSS flips strip, putting panel1 at bottom
    gameScreen?.setAttribute('data-me', 'black');
  } else {
    // I am WHITE (panel2) — already at bottom naturally
    gameScreen?.setAttribute('data-me', 'white');
  }

  // Bottom panel = me, top panel = opponent
  const myPanelId  = iAmBlack ? 'panel1' : 'panel2';
  const oppPanelId = iAmBlack ? 'panel2' : 'panel1';
  const myNameEl   = document.getElementById(iAmBlack ? 'p1name' : 'p2name');
  const oppNameEl  = document.getElementById(iAmBlack ? 'p2name' : 'p1name');
  if (myNameEl)  myNameEl.textContent  = myName;
  if (oppNameEl) oppNameEl.textContent = oppName;

  document.getElementById('gameModeLabel').textContent =
    mode === 'ai' ? `vs ${oppName}` : `vs ${oppName}`;

  // Opponent avatar — goes in the OPPONENT panel
  const av2 = document.querySelector(`#${oppPanelId} .ss-avatar`);
  if (av2) {
    if (G.opponent?.photo) {
      av2.innerHTML = `<img src="${G.opponent.photo}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" alt="">`;
      av2.className = 'ss-avatar';
    } else if (G.opponent) {
      av2.textContent = (G.opponent.name||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
      av2.className = 'ss-avatar';
      av2.style.fontSize = '.7rem';
    } else {
      av2.textContent = mode === 'ai' ? '🤖' : '♙';
      av2.className = 'ss-avatar white-avatar';
      av2.style.fontSize = '';
    }
  }

  // Reset MY avatar to default state
  const myAv = document.querySelector(`#${myPanelId} .ss-avatar`);
  if (myAv) {
    myAv.className = 'ss-avatar black-avatar';
    myAv.textContent = '♟';
    myAv.style.fontSize = '';
  }

  // Add "YOU" badge to my panel, remove from opponent panel
  document.querySelectorAll('.ss-me-badge').forEach(el => el.remove());
  const myInfo = document.querySelector(`#${myPanelId} .ss-info`);
  if (myInfo) {
    const badge = document.createElement('span');
    badge.className = 'ss-me-badge';
    badge.textContent = 'YOU';
    myInfo.appendChild(badge);
  }

  document.getElementById('p1timer').textContent = '00:00';
  document.getElementById('p2timer').textContent = '00:00';

  // Switch to game screen
  showScreen('gameScreen');

  // ── Show Game ID badge ───────────────────────────────────────────────────
  const gameIdBadge = document.getElementById('gameIdBadge');
  const gameIdValue = document.getElementById('gameIdValue');
  if (gameIdBadge && gameIdValue && G.gameId) {
    gameIdValue.textContent = G.gameId;
    gameIdBadge.classList.remove('hidden');
  } else if (gameIdBadge) {
    gameIdBadge.classList.add('hidden');
  }

  // Apply MY piece colour to BLACK (player 1)
  if (typeof applyPieceTheme === 'function' && window.pieceTheme) applyPieceTheme(window.pieceTheme);

  // Apply OPPONENT's piece colour to WHITE (player 2), if they have one
  const myThemeId  = window.pieceTheme?.id || 'classic';
  const oppThemeId = G.opponent?.pieceThemeId || 'classic';

  if (G.opponent?.pieceThemeId && window.PIECE_THEMES) {
    const oppTheme = window.PIECE_THEMES.find(t => t.id === G.opponent.pieceThemeId);
    if (oppTheme) applyOpponentTheme(oppTheme);
  } else {
    applyOpponentTheme(null);
  }

  // Flag when both players share the same theme — board will show P1/P2 labels
  G.sameTheme = (myThemeId === oppThemeId);

  renderBoard(); updatePanels(); updateTurnIndicator(); setStatus(turnMsg()); startTimer(); startCountdown();
  // Reset strike dots
  updateStrikeDots(BLACK, 0);
  updateStrikeDots(WHITE, 0);

  const modal = document.getElementById('winModal');
  modal.classList.add('hidden');
  modal.classList.remove('modal-show');
}
