import { Chess } from './vendor/chess.mjs';
import { files, ranks, names, sideNames, imageFor, describeMove } from './chess-ui.mjs';

export function makeLine(moves, fen) {
  const game = new Chess(fen);
  const initial = game.fen();
  const steps = moves.map(san => game.move(san));
  return { game, initial, steps };
}

function coordinates(chars, className) {
  const row = document.createElement('div');
  row.className = className;
  row.setAttribute('aria-hidden', 'true');
  for (const char of chars) {
    const label = document.createElement('span');
    label.textContent = char;
    row.append(label);
  }
  return row;
}

export class Study {
  constructor(stem, onPosition) {
    const get = suffix => document.getElementById(`${stem}-${suffix}`);
    this.board = get('board');
    this.caption = get('position');
    this.score = get('plies');
    this.first = get('first');
    this.last = get('last');
    this.prev = get('prev');
    this.next = get('next');
    this.onPosition = onPosition;
    this.tiles = new Map();
    this.first.addEventListener('click', () => this.go(0));
    this.last?.addEventListener('click', () => this.go(this.line.steps.length));
    this.prev.addEventListener('click', () => this.go(this.ply - 1));
    this.next.addEventListener('click', () => this.go(this.ply + 1));
    this.score.addEventListener('click', event => {
      const move = event.target.closest('[data-ply]');
      if (move) this.go(Number(move.dataset.ply));
    });
    const moveByKey = event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      this.go(this.ply + (event.key === 'ArrowLeft' ? -1 : 1));
    };
    this.board.addEventListener('keydown', moveByKey);
    this.score.addEventListener('keydown', moveByKey);
  }

  setLine(line, { flipped = false, ply = 0 } = {}) {
    this.line = line;
    this.buildBoard(flipped);
    const notation = document.createDocumentFragment();
    for (const [index, move] of line.steps.entries()) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.ply = String(index + 1);
      button.className = 'study-move';
      const number = Math.floor(index / 2) + 1;
      button.textContent = move.color === 'w' ? `${number}.${move.san}` : move.san;
      button.setAttribute('aria-label', `第 ${number} 回合，${describeMove(move)}`);
      notation.append(button);
    }
    this.score.replaceChildren(notation);
    this.go(ply);
  }

  buildBoard(flipped) {
    if (this.tiles.size && this.flipped === flipped) return;
    this.flipped = flipped;
    this.tiles.clear();
    const columns = flipped ? [...files].reverse() : [...files];
    const rows = flipped ? [...ranks].reverse() : [...ranks];
    const grid = document.createElement('div');
    grid.className = 'study-grid';
    grid.setAttribute('aria-hidden', 'true');
    for (const [row, rank] of rows.entries()) {
      for (const [column, file] of columns.entries()) {
        const tile = document.createElement('div');
        tile.className = (row + column) % 2 ? 'tile dark' : 'tile';
        tile.dataset.studySquare = file + rank;
        tile.style.backgroundPosition = `${(row + column * 3) % 8 * 100 / 7}% ${(row * 3 + column) % 8 * 100 / 7}%`;
        grid.append(tile);
        this.tiles.set(file + rank, tile);
      }
    }
    this.board.replaceChildren(grid, coordinates(columns, 'study-files'), coordinates(rows, 'study-ranks'));
  }

  go(ply, hint = null) {
    const { initial, steps } = this.line;
    this.ply = Math.max(0, Math.min(ply, steps.length));
    const move = steps[this.ply - 1];
    const game = new Chess(move?.after ?? initial);
    const pieces = game.board().flat().filter(Boolean);
    const squares = new Map(pieces.map(piece => [piece.square, piece]));
    const side = game.turn();
    const check = game.isCheck();
    for (const [square, tile] of this.tiles) {
      const piece = squares.get(square);
      const code = piece ? piece.color + piece.type : '';
      if (tile.dataset.piece !== code) {
        tile.dataset.piece = code;
        if (piece) {
          const image = imageFor(piece.color, piece.type);
          image.className = 'flat-piece';
          tile.replaceChildren(image);
        } else tile.replaceChildren();
      }
      tile.classList.toggle('last', square === move?.from || square === move?.to);
      tile.classList.toggle('hint', square === hint?.from || square === hint?.to);
      tile.classList.toggle('checked', check && piece?.type === 'k' && piece.color === side);
    }
    const caption = move ? describeMove(move) : `${sideNames[game.turn()]}走棋`;
    this.board.setAttribute('aria-label', `当前局面。白方 ${pieces.filter(p => p.color === 'w').map(p => names[p.type] + p.square).join('、')}。黑方 ${pieces.filter(p => p.color === 'b').map(p => names[p.type] + p.square).join('、')}。`);
    this.caption.textContent = `${this.ply} / ${steps.length} 步 · ${caption}`;
    this.prev.disabled = this.first.disabled = this.ply === 0;
    this.next.disabled = this.ply === steps.length;
    if (this.last) this.last.disabled = this.next.disabled;
    this.score.querySelector('[aria-current]')?.removeAttribute('aria-current');
    const active = this.score.querySelector(`[data-ply="${this.ply}"]`);
    active?.setAttribute('aria-current', 'step');
    if (active) {
      const item = active.getBoundingClientRect();
      const area = this.score.getBoundingClientRect();
      if (item.top < area.top) this.score.scrollTop -= area.top - item.top;
      else if (item.bottom > area.bottom) this.score.scrollTop += item.bottom - area.bottom;
    } else this.score.scrollTop = 0;
    this.onPosition?.(this.ply, hint);
  }
}
