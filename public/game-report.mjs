import { Chess } from './vendor/chess.mjs';
import { search } from './engine.mjs';

export const REPORT_VERSION = 1;
const forcedMate = 29000;
const notable = 75;

function scoreMove(board, played, depth, time) {
  const scored = search({ position: board, review: { played, depth, time } });
  const { best, actual, reply, bestReply } = scored.comparison;
  const kind = actual < -forcedMate && best > -forcedMate ? 'allowed-mate'
    : best > forcedMate && actual < forcedMate ? 'missed-mate'
      : 'loss';
  const loss = kind === 'loss' && (best > forcedMate && actual > forcedMate || best < -forcedMate && actual < -forcedMate)
    ? 0 : Math.max(0, best - actual);
  return { searchDepth: scored.depth, loss, kind, best, actual, suggestion: scored.move, reply, bestReply };
}

function compareMoments(a, b) {
  return b.analysis.loss - a.analysis.loss || a.ply - b.ply;
}

function momentFor(entry) {
  const { ply, played, analysis } = entry;
  const board = new Chess(played.before);
  const alternative = board.move(analysis.suggestion);
  const afterSuggestion = analysis.bestReply ? board.move(analysis.bestReply) : null;
  board.load(played.after);
  const reply = analysis.reply ? board.move(analysis.reply) : null;
  return {
    ply, color: played.color, san: played.san, suggested: alternative.san,
    from: alternative.from, to: alternative.to, reply: reply?.san ?? null,
    replyCapture: reply?.captured ?? null, replyCheck: Boolean(reply?.san.includes('+')),
    counter: afterSuggestion?.san ?? null, kind: analysis.kind,
    loss: Math.round(analysis.loss), mate: analysis.actual < -forcedMate || analysis.best > forcedMate,
  };
}

export function reviewGame(moves, onProgress = () => {}) {
  const board = new Chess();
  const entries = [];
  const count = moves.length;
  onProgress('scan', 0, count);
  for (const [index, san] of moves.entries()) {
    const played = board.move(san);
    board.undo();
    const analysis = scoreMove(board, played, 2, 52);
    entries.push({ ply: index + 1, played, analysis });
    board.move(played);
    if ((index + 1) % 4 === 0 || index + 1 === count) onProgress('scan', index + 1, count);
  }

  const candidates = entries.filter(entry => entry.analysis.loss >= 55).sort(compareMoments).slice(0, 9);
  if (candidates.length) onProgress('refine', 0, candidates.length);
  for (const [index, entry] of candidates.entries()) {
    // Reuse the actual game prefix so repetition and move counts still apply.
    const earlier = new Chess();
    for (let ply = 0; ply < entry.ply - 1; ply += 1) earlier.move(moves[ply]);
    const deeper = scoreMove(earlier, entry.played, 3, 130);
    if (deeper.searchDepth >= entry.analysis.searchDepth) entry.analysis = deeper;
    onProgress('refine', index + 1, candidates.length);
  }

  const highlighted = entries.filter(entry => entry.analysis.loss >= notable).sort(compareMoments);
  const mostUseful = highlighted.slice(0, 7);
  const unrepresented = highlighted.find(entry => !mostUseful.some(moment => moment.played.color === entry.played.color));
  if (unrepresented) mostUseful[mostUseful.length - 1] = unrepresented;
  const white = entry => entry.played.color === 'w' ? 1 : -1;
  return {
    version: REPORT_VERSION,
    scanned: count,
    scores: entries.length ? [entries[0].analysis.best, ...entries.map(entry => entry.analysis.actual * white(entry))] : [],
    counts: {
      w: highlighted.filter(entry => entry.played.color === 'w').length,
      b: highlighted.filter(entry => entry.played.color === 'b').length,
    },
    moments: mostUseful.map(momentFor),
  };
}
