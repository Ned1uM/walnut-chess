import { Chess } from './vendor/chess.mjs';

const values = { p: 100, n: 320, b: 335, r: 505, q: 945, k: 0 };
const mate = 30000;
const timeout = Symbol('search deadline');
const playingLevels = {
  easy: { maxDepth: 2, time: 180, randomWindow: 64 },
  normal: { maxDepth: 3, time: 460, randomWindow: 0 },
  hard: { maxDepth: 4, time: 1050, randomWindow: 0 },
  expert: { maxDepth: 6, time: 3500, randomWindow: 0 },
};

function scorePiece(type, file, rank, endgame) {
  const distance = Math.abs(file - 3.5) + Math.abs(rank - 3.5);
  const center = 7 - distance;
  switch (type) {
    case 'p': return rank * 8 + (3.5 - Math.abs(file - 3.5)) * 5 + rank ** 2 * (endgame ? 2 : 0);
    case 'n': return center * 12 - (distance > 4.5 ? 14 : 0);
    case 'b': return center * 6 + (rank > 0 ? 8 : 0);
    case 'r': return center * 2 + (rank === 6 ? 18 : 0);
    case 'q': return center * 2 - (!endgame && rank > 2 ? 10 : 0);
    case 'k': return endgame ? center * 12 : 14 * Number((file === 2 || file === 6) && rank === 0) - rank * 9 - center * 4;
    default: return 0;
  }
}

function evaluate(game) {
  // This worker is tied to the vendored chess.js version. Its 0x88 board and
  // make/unmake routines allow many thousands of legal positions per search.
  const board = game._board;
  const pawns = { w: Array(8).fill(0), b: Array(8).fill(0) };
  const bishops = { w: 0, b: 0 };
  let majorMaterial = 0;
  for (const piece of board) {
    if (piece && piece.type !== 'p') majorMaterial += values[piece.type];
  }
  const endgame = majorMaterial < 2520;
  let white = 0;
  for (let index = 0; index < 120; index += 1) {
    if (index & 0x88) { index += 7; continue; }
    const piece = board[index];
    if (!piece) continue;
    const file = index & 7;
    const rank = piece.color === 'w' ? 7 - (index >> 4) : index >> 4;
    const sign = piece.color === 'w' ? 1 : -1;
    white += sign * (values[piece.type] + scorePiece(piece.type, file, rank, endgame));
    if (piece.type === 'p') pawns[piece.color][file] += 1;
    if (piece.type === 'b') bishops[piece.color] += 1;
  }
  const pawnPenalty = counts => counts.reduce((total, count, file) => {
    if (!count) return total;
    return total + (count - 1) * 13 + (!counts[file - 1] && !counts[file + 1] ? 10 : 0);
  }, 0);
  white += pawnPenalty(pawns.b) - pawnPenalty(pawns.w);
  white += (Number(bishops.w >= 2) - Number(bishops.b >= 2)) * 24;
  return (game.turn() === 'w' ? white : -white) + 8;
}

function orderValue(move) {
  const file = move.to & 7;
  const rank = move.to >> 4;
  const center = 7 - Math.abs(file - 3.5) - Math.abs(rank - 3.5);
  return (move.captured ? 12 * values[move.captured] - values[move.piece] : 0)
    + (move.promotion ? values[move.promotion] + 500 : 0) + center;
}

function algebraic(index) {
  return 'abcdefgh'[index & 7] + (8 - (index >> 4));
}

function asMove(move) {
  return { from: algebraic(move.from), to: algebraic(move.to), promotion: move.promotion };
}

export function search({ fen, moves = [], level = 'normal', analysis = false, quick = false, position, review }) {
  const game = position ?? new Chess(fen);
  for (const move of moves) game.move(move);
  const roots = game._moves().sort((a, b) => orderValue(b) - orderValue(a));
  if (!roots.length) return null;

  const settings = review
    ? { maxDepth: review.depth, time: review.time, randomWindow: 0 }
    : analysis
      ? { maxDepth: 5, time: 1350, randomWindow: 0 }
      : playingLevels[level];
  const playedRoot = review && roots.find(move => (
    algebraic(move.from) === review.played.from && algebraic(move.to) === review.played.to
    && move.promotion === review.played.promotion
  ));
  const trackVariation = analysis || Boolean(review);
  const deadline = performance.now() + (quick ? Math.min(260, settings.time) : settings.time);
  const seen = new Map(game._positionCount);
  const side = game.turn();
  const variations = [];
  const preferred = new Map();
  let nodes = 0;
  let completed = 0;

  function visit() {
    nodes += 1;
    if ((nodes & 127) === 0 && (!review || completed > 0) && performance.now() >= deadline) throw timeout;
  }

  function inDraw() {
    return game.isDrawByFiftyMoves() || seen.get(game._hash) >= 3 || game.isInsufficientMaterial();
  }

  function withMove(move, child) {
    game._makeMove(move);
    const hash = game._hash;
    const previous = seen.get(hash) ?? 0;
    seen.set(hash, previous + 1);
    try {
      return -child();
    } finally {
      if (previous) seen.set(hash, previous);
      else seen.delete(hash);
      game._undoMove();
    }
  }

  function quiescence(alpha, beta, ply, remaining) {
    visit();
    const inCheck = game.isCheck();
    const legal = game._moves();
    if (!legal.length) return inCheck ? -mate + ply : 0;
    if (inDraw()) return 0;
    const baseline = evaluate(game);
    if (remaining === 0) return baseline;
    if (!inCheck) {
      if (baseline >= beta) return baseline;
      alpha = Math.max(alpha, baseline);
    }
    const tactical = inCheck ? legal : legal.filter(move => move.captured || move.promotion);
    tactical.sort((a, b) => orderValue(b) - orderValue(a));
    for (const move of tactical) {
      const score = withMove(move, () => quiescence(-beta, -alpha, ply + 1, remaining - 1));
      if (score >= beta) return score;
      alpha = Math.max(alpha, score);
    }
    return alpha;
  }

  function negamax(depth, alpha, beta, ply) {
    if (trackVariation) variations[ply] = [];
    if (depth === 0) return quiescence(alpha, beta, ply, review ? 2 : 3);
    visit();
    const legal = game._moves();
    if (!legal.length) return game.isCheck() ? -mate + ply : 0;
    if (inDraw()) return 0;
    legal.sort((a, b) => orderValue(b) - orderValue(a));
    const key = game._hash;
    const previous = preferred.get(key);
    if (previous) {
      const first = legal.findIndex(move => move.from === previous.from && move.to === previous.to && move.promotion === previous.promotion);
      if (first > 0) legal.unshift(...legal.splice(first, 1));
    }
    let best = -Infinity;
    let bestMove;
    for (const move of legal) {
      const score = withMove(move, () => negamax(depth - 1, -beta, -alpha, ply + 1));
      if (score > best) {
        best = score;
        bestMove = move;
        if (trackVariation) variations[ply] = [move, ...variations[ply + 1]];
      }
      alpha = Math.max(alpha, score);
      if (alpha >= beta) break;
    }
    preferred.set(key, bestMove);
    return best;
  }

  let ranking = roots.map(move => ({ move, score: 0, variation: trackVariation ? [move] : null }));
  for (let depth = 1; depth <= settings.maxDepth; depth += 1) {
    try {
      let best = -Infinity;
      const scored = ranking.map(({ move }) => {
        const ceiling = settings.randomWindow || move === playedRoot ? Infinity : -best;
        const score = withMove(move, () => negamax(depth - 1, -Infinity, ceiling, 1));
        best = Math.max(best, score);
        return { move, score, variation: trackVariation ? [move, ...variations[1]] : null };
      });
      ranking = scored.sort((a, b) => b.score - a.score);
      completed = depth;
      if (!review && (Math.abs(ranking[0].score) > mate - 100 || roots.length === 1 && !analysis)) break;
    } catch (error) {
      if (error !== timeout) throw error;
      break;
    }
  }

  let choice = ranking[0];
  if (settings.randomWindow && Math.abs(choice.score) < mate - 100) {
    const candidates = ranking.filter(entry => choice.score - entry.score <= settings.randomWindow);
    choice = candidates[Math.floor(Math.random() * candidates.length)];
  }
  const move = asMove(choice.move);
  const line = analysis ? choice.variation.slice(0, 4).map(asMove) : undefined;
  if (line?.length === 1) {
    // A very short search can finish before the first full reply is scored.
    const continuation = [...moves, move];
    const next = new Chess(fen);
    for (const action of continuation) next.move(action);
    if (!next.isGameOver()) {
      const reply = search({ fen, moves: continuation, quick: true });
      if (reply) line.push(reply.move);
    }
  }
  const played = playedRoot && ranking.find(candidate => candidate.move === playedRoot);
  return {
    move,
    line,
    score: Math.round(choice.score * (side === 'w' ? 1 : -1)),
    mateIn: Math.abs(choice.score) > mate - 100 ? Math.ceil((mate - Math.abs(choice.score)) / 2) : null,
    depth: completed,
    ...(played ? {
      comparison: {
        best: choice.score,
        actual: played.score,
        reply: played.variation[1] ? asMove(played.variation[1]) : null,
        bestReply: choice.variation[1] ? asMove(choice.variation[1]) : null,
      },
    } : {}),
  };
}
