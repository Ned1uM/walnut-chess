import { Chess } from './vendor/chess.mjs';

const points = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

function capturesBy(position, color) {
  const fen = position.fen().split(' ');
  if (fen[1] !== color) {
    fen[1] = color;
    fen[3] = '-';
  }
  const board = new Chess(fen.join(' '));
  const captures = new Map();
  for (const move of board.moves({ verbose: true })) {
    if (!move.captured || move.captured === 'k') continue;
    const square = move.isEnPassant() ? move.to[0] + move.from[1] : move.to;
    const gain = points[move.captured] + (move.promotion ? points[move.promotion] - 1 : 0);
    board.move(move);
    const recapture = board.moves({ verbose: true }).find(reply => reply.captured && reply.to === move.to);
    board.undo();
    const loss = gain - (recapture ? points[move.promotion ?? move.piece] : 0);
    if (!captures.has(square) || captures.get(square).loss < loss) {
      captures.set(square, { move, loss, recapture });
    }
  }
  return captures;
}

export function findSavedPiece(before, after, move) {
  // A forced reply to check is handled separately from ordinary material threats.
  if (before.isCheck() || move.san.endsWith('#')) return null;
  const opponent = move.color === 'w' ? 'b' : 'w';
  const threats = [...capturesBy(before, opponent)].filter(([, threat]) => threat.loss > 0);
  if (!threats.length) return null;
  threats.sort((a, b) => b[1].loss - a[1].loss);
  const gaveCheck = after.isCheck();
  const remaining = capturesBy(after, opponent);
  for (const [from, threat] of threats) {
    const to = from === move.from ? move.to : from;
    if (after.get(to)?.color !== move.color) continue;
    if (gaveCheck && after.attackers(to, opponent).length) continue;
    const response = remaining.get(to);
    if (response?.loss > 0) continue;
    return { from, to, piece: before.get(from), threat: threat.move, recapture: response?.recapture ?? null };
  }
  return null;
}
