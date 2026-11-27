export const files = 'abcdefgh';
export const ranks = '87654321';
export const names = { p: '兵', n: '马', b: '象', r: '车', q: '后', k: '王' };
export const sideNames = { w: '白方', b: '黑方' };
export const colors = { w: '白', b: '黑' };
export const levels = { easy: '入门', normal: '标准', hard: '进阶', expert: '专家' };

export function imageFor(color, type) {
  const image = new Image();
  image.src = `./pieces/${color}${type}.png`;
  image.alt = '';
  image.draggable = false;
  return image;
}

export function describeMove(move) {
  if (move.flags.includes('k')) return `${sideNames[move.color]}王翼易位`;
  if (move.flags.includes('q')) return `${sideNames[move.color]}后翼易位`;
  const piece = colors[move.color] + names[move.piece];
  const target = `${move.from} 到 ${move.to}`;
  if (move.promotion) return `${piece} ${target}，升变为${names[move.promotion]}`;
  if (move.flags.includes('e')) return `${piece} ${target}，吃过路兵`;
  if (move.captured) return `${piece} ${target}，吃${names[move.captured]}`;
  return `${piece} ${target}`;
}

function makePgn(game, { mode, color, result = '*', title = 'Walnut Chess Room' }) {
  game.setHeader('White', mode === 'local' ? 'White' : color === 'w' ? 'Player' : 'Computer');
  game.setHeader('Black', mode === 'local' ? 'Black' : color === 'b' ? 'Player' : 'Computer');
  game.setHeader('Event', title.replace(/["\\\r\n]/g, ' '));
  game.setHeader('Result', result);
  return game.pgn();
}
export function downloadPgn(game, options, showToast) {
  const pgn = makePgn(game, options);
  savePgn(pgn, showToast);
}
function savePgn(pgn, showToast) {
  const url = URL.createObjectURL(new Blob([pgn], { type: 'application/x-chess-pgn' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'walnut-chess.pgn';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast('已发起 PGN 下载。');
}
export async function copyPgn(game, options, showToast) {
  const pgn = makePgn(game, options);
  try {
    await navigator.clipboard.writeText(pgn);
    showToast('已复制 PGN 棋谱。');
    return;
  } catch {
    const area = document.createElement('textarea');
    const previous = document.activeElement;
    area.value = pgn;
    area.className = 'sr-only';
    document.body.append(area);
    area.select();
    const copied = document.execCommand('copy');
    area.remove();
    previous?.focus({ preventScroll: true });
    if (copied) {
      showToast('已复制 PGN 棋谱。');
      return;
    }
  }
  savePgn(pgn, showToast);
}
