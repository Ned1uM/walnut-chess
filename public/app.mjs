import { Chess } from './vendor/chess.mjs';
import { findSavedPiece } from './tactics.mjs';
import { files, ranks, names, sideNames, colors, levels, imageFor, describeMove, copyPgn, downloadPgn } from './chess-ui.mjs';
import { initNotebook } from './notebook.mjs';
import { initTacticsBook } from './tactics-book.mjs';

const el = id => document.getElementById(id);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const narrow = matchMedia('(max-width: 820px)');
const storageKey = 'walnut-chess.match.v1';
const defaultSettings = { mode: 'computer', color: 'w', level: 'normal', view: '3d', flipped: false, sound: false };
const newDialog = el('new-dialog');
const newForm = el('new-form');
const promotionDialog = el('promotion-dialog');
const analysisDialog = el('analysis-dialog');
const soundButton = el('sound');
const canvas = el('board-3d');
const flatBoard = el('board-2d');

function newMatchId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function restore() {
  const game = new Chess();
  let settings = { ...defaultSettings };
  const history = [];
  let id = newMatchId();
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey));
    if (typeof stored?.id === 'string') id = stored.id;
    if (stored?.settings) {
      const { mode, color, level, view, flipped, sound } = stored.settings;
      settings = {
        mode: mode === 'local' ? 'local' : 'computer',
        color: color === 'b' ? 'b' : 'w',
        level: Object.hasOwn(levels, level) ? level : 'normal',
        view: view === '2d' ? '2d' : '3d',
        flipped: flipped === true,
        sound: sound === true,
      };
    }
    if (Array.isArray(stored?.moves)) for (const move of stored.moves) history.push(game.move(move));
  } catch {
    game.reset();
    history.length = 0;
    id = newMatchId();
  }
  return { game, settings, history, id };
}

let { game, settings, history, id: matchId } = restore();
let shownPosition = game;
let shownMove = null;
let replayPly = null;
let demo = null;
let pieces = [];
let piecesBySquare = new Map();
let result = null;
let selected = null;
let legal = [];
let hint = null;
let focusSquare = settings.flipped ? 'e7' : 'e2';
let keyboardFocus = false;
let pendingPromotion = null;
let tiles = new Map();
let board3d = null;
let preparing3d = null;
let failed3d = false;
let picked3d = null;
let cancelComputer = null;
let cancelAnalysis = null;
let replyTimer = 0;
let analyzed = null;
let audio = null;
let toastTimer = 0;

function save() {
  try {
    localStorage.setItem(storageKey, JSON.stringify({ id: matchId, settings, moves: history.map(move => move.san) }));
  } catch {
    // The current game remains usable when browser storage is restricted.
  }
}

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const use = document.createElementNS(svg.namespaceURI, 'use');
  svg.classList.add('icon');
  svg.setAttribute('aria-hidden', 'true');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

function describeSquare(square) {
  const piece = piecesBySquare.get(square);
  return `${square} · ${piece ? colors[piece.color] + names[piece.type] : '空格'}`;
}

function getResult() {
  if (game.isCheckmate()) {
    const winner = game.turn() === 'w' ? 'b' : 'w';
    return { title: `${sideNames[winner]}将死获胜`, pgn: winner === 'w' ? '1-0' : '0-1', message: `${sideNames[game.turn()]}无法解除将军` };
  }
  let reason = '';
  if (game.isStalemate()) reason = '逼和，当前一方无子可走';
  else if (game.isInsufficientMaterial()) reason = '双方子力不足以将死';
  else if (game.isThreefoldRepetition()) reason = '同一局面出现三次';
  else if (game.isDrawByFiftyMoves()) reason = '连续 50 回合无吃子与兵移动';
  return reason ? { title: '和棋', pgn: '1/2-1/2', message: reason } : null;
}

function isComputerTurn() {
  return !result && settings.mode === 'computer' && game.turn() !== settings.color;
}

function isReviewing() {
  return replayPly !== null || demo !== null;
}

function canPlay() {
  return !isReviewing() && !result && !isComputerTurn() && !pendingPromotion;
}

function canAnalyze() {
  if (demo || pendingPromotion) return false;
  return replayPly === null ? canPlay() : !shownPosition.isGameOver();
}

function reviewBase() {
  return demo?.basePly ?? replayPly ?? history.length;
}

function boardAxes() {
  const reverse = value => [...value].reverse().join('');
  return settings.flipped ? [reverse(files), reverse(ranks)] : [files, ranks];
}

function buildFlatBoard() {
  const [columns, rows] = boardAxes();
  tiles = new Map();
  const matrix = document.createDocumentFragment();
  for (const [row, rank] of [...rows].entries()) {
    for (const [column, file] of [...columns].entries()) {
      const square = file + rank;
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.dataset.square = square;
      tile.className = (column + row) % 2 ? 'tile dark' : 'tile';
      tile.style.backgroundPosition = `${(row * 7 + column * 3) % 8 * 100 / 7}% ${(row * 3 + column) % 8 * 100 / 7}%`;
      tiles.set(square, tile);
      matrix.append(tile);
    }
  }
  const labels = chars => [...chars].map(char => {
    const label = document.createElement('span');
    label.textContent = char;
    return label;
  });
  flatBoard.replaceChildren(matrix);
  el('flat-files').replaceChildren(...labels(columns));
  el('flat-ranks').replaceChildren(...labels(rows));
}

function renderFlatPieces() {
  for (const [square, tile] of tiles) {
    const piece = piecesBySquare.get(square);
    const code = piece ? piece.color + piece.type : '';
    if (tile.dataset.piece !== code) {
      tile.dataset.piece = code;
      if (piece) {
        const image = imageFor(piece.color, piece.type);
        image.className = 'flat-piece';
        tile.replaceChildren(image);
      } else tile.replaceChildren();
    }
    tile.classList.toggle('occupied', Boolean(piece));
  }
}

function renderMarks() {
  const last = shownMove;
  const inCheck = shownPosition.isCheck();
  const check = inCheck ? pieces.find(piece => piece.type === 'k' && piece.color === shownPosition.turn())?.square : null;
  const held = picked3d?.held ? picked3d : null;
  const activeSquare = held?.source ?? selected;
  const destinations = held?.destinations ?? new Set(legal.map(move => move.to));
  const activeHint = held ? null : hint ?? (demo?.step === 0 ? demo.line[0] : null);
  const saved = demo?.saved;
  const protectedSquare = saved && demo.step <= 1 ? (demo.step === 0 ? saved.from : saved.to) : null;
  for (const [square, tile] of tiles) {
    tile.tabIndex = square === focusSquare ? 0 : -1;
    tile.classList.toggle('last', square === last?.from || square === last?.to);
    tile.classList.toggle('selected', square === activeSquare);
    tile.classList.toggle('legal', destinations.has(square));
    tile.classList.toggle('checked', square === check);
    tile.classList.toggle('hint', square === activeHint?.from || square === activeHint?.to);
    tile.classList.toggle('protected', square === protectedSquare);
    let label = describeSquare(square);
    if (square === check) label += '，被将军';
    if (square === activeSquare) label += '，已选中';
    if (destinations.has(square)) label += '，可落子';
    if (square === protectedSquare) label += '，分析标出的棋子';
    tile.setAttribute('aria-label', label);
  }
  canvas.setAttribute('aria-label', `立体棋盘，${describeSquare(focusSquare)}`);
  board3d?.setMarkers({
    last, selected: activeSquare, legal: destinations, check, hint: activeHint,
    focus: keyboardFocus ? focusSquare : null, dropTarget: held?.target, protectedSquare,
  });
}

function renderPlayer(card, color, displayedMoves) {
  const isComputer = settings.mode === 'computer' && color !== settings.color;
  const label = settings.mode === 'local' ? sideNames[color] : isComputer ? '电脑' : '你';
  const avatar = card.querySelector('.player-avatar');
  const face = isComputer ? 'computer' : 'user';
  if (avatar.dataset.icon !== face) {
    avatar.dataset.icon = face;
    avatar.replaceChildren(icon(face));
  }
  avatar.classList.toggle('white', color === 'w');
  card.querySelector('strong').textContent = label;
  const detail = card.querySelector('.side-name');
  detail.textContent = settings.mode === 'local' ? color === 'w' ? '先手' : '后手' : sideNames[color];
  const active = !isReviewing() && !result && game.turn() === color;
  card.classList.toggle('active', active);
  card.querySelector('.turn-tag').hidden = !active;

  const captures = displayedMoves.filter(move => move.color === color && move.captured);
  const captured = card.querySelector('.captured');
  const opponent = color === 'w' ? 'b' : 'w';
  captured.replaceChildren(...captures.map(move => imageFor(opponent, move.captured)));
  if (captures.length) {
    captured.setAttribute('role', 'img');
    captured.setAttribute('aria-label', `已吃子：${captures.map(move => names[move.captured]).join('、')}`);
  } else {
    captured.removeAttribute('role');
    captured.removeAttribute('aria-label');
  }
}

function renderMatch() {
  const local = settings.mode === 'local';
  const review = isReviewing();
  const displayedMoves = review ? history.slice(0, reviewBase()) : history;
  if (demo) displayedMoves.push(...demo.line.slice(0, demo.step));
  el('mode-label').textContent = local ? '同屏双人' : `人机 · ${levels[settings.level]}`;
  renderPlayer(el('player-top'), settings.flipped ? 'w' : 'b', displayedMoves);
  renderPlayer(el('player-bottom'), settings.flipped ? 'b' : 'w', displayedMoves);
  const status = el('turn-label');
  const activity = el('activity');
  const check = game.isCheck();
  const computer = isComputerTurn();
  const last = local ? history.at(-1) : history.findLast(move => move.color !== settings.color);
  status.textContent = result ? result.title : check ? `${sideNames[game.turn()]}被将军` : local ? `${sideNames[game.turn()]}走棋` : computer ? '电脑思考中' : '轮到你了';
  activity.textContent = result ? result.message : last ? `${local ? '' : '电脑走了 · '}${describeMove(last)}` : history.length ? describeMove(history.at(-1)) : '白方先行';
  if (computer && check) activity.textContent = '电脑正在应对将军';
  if (review) {
    status.textContent = demo ? '分析演示中' : '棋谱回放中';
    activity.textContent = shownMove ? describeMove(shownMove) : '开局';
  }
  el('match-status').dataset.state = review ? 'review' : result ? 'done' : check ? 'check' : computer ? 'thinking' : 'play';
  el('undo').disabled = review || !history.some(move => local || move.color === settings.color);
  el('analysis').disabled = review || !canAnalyze();
}

function renderHistory(rebuild = false) {
  const list = el('move-list');
  if (rebuild) {
    el('history-empty').hidden = Boolean(history.length);
    el('score-sheet').hidden = !history.length;
    el('copy').disabled = !history.length;
    el('download-pgn').disabled = !history.length;
    el('save-record').disabled = !history.length;
    const focusPly = list.contains(document.activeElement) ? document.activeElement.dataset.ply : null;
    const rows = document.createDocumentFragment();
    for (let index = 0; index < history.length; index += 2) {
      const row = document.createElement('li');
      const number = document.createElement('span');
      number.className = 'move-number';
      number.textContent = `${index / 2 + 1}.`;
      row.append(number);
      for (const ply of [index, index + 1]) {
        const move = history[ply];
        if (!move) continue;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'move-link';
        button.dataset.ply = String(ply + 1);
        button.textContent = move.san;
        button.title = describeMove(move);
        button.setAttribute('aria-label', `第 ${ply + 1} 步，${describeMove(move)}`);
        button.classList.toggle('current', ply === history.length - 1);
        row.append(button);
      }
      rows.append(row);
    }
    list.replaceChildren(rows);
    if (focusPly) list.querySelector(`[data-ply="${focusPly}"]`)?.focus({ preventScroll: true });
  }
  list.querySelector('[aria-current]')?.removeAttribute('aria-current');
  const active = list.querySelector(`[data-ply="${reviewBase()}"]`);
  if (active) {
    active.setAttribute('aria-current', 'step');
    const area = list.getBoundingClientRect();
    const item = active.getBoundingClientRect();
    if (item.top < area.top) list.scrollTop -= area.top - item.top;
    else if (item.bottom > area.bottom) list.scrollTop += item.bottom - area.bottom;
  } else list.scrollTop = 0;
}

function renderReview() {
  const active = isReviewing();
  el('board-tip').textContent = active ? '用左右方向键回放' : failed3d ? '当前设备使用俯视棋盘' : '点击或拖动棋子';
  el('board-help').textContent = active
    ? '回放时用左右方向键查看前后走法。'
    : '点击或拖动棋子。用方向键移动焦点，用空格或回车选择，用 Escape 取消选择。';
  el('board-review').hidden = !active;
  el('board-activity').hidden = !narrow.matches || active;
  el('board-stage').toggleAttribute('data-review', active);
  if (!active) return;
  const position = demo ? demo.step : replayPly;
  const count = demo ? demo.line.length : history.length;
  el('review-title').textContent = demo ? '分析演示' : '棋谱回放';
  const lead = demo ? ['起始局面', '推荐走法', '预计对方应对'][position] ?? '后续走法' : position === 0 ? '开局' : `第 ${position} 步`;
  el('review-caption').textContent = demo && position === 0 ? lead : shownMove ? `${lead} · ${shownMove.san} · ${describeMove(shownMove)}` : lead;
  const note = el('review-note');
  note.hidden = !(demo?.saved && position <= 1);
  note.textContent = note.hidden ? '' : demo.saved.note;
  el('review-previous').disabled = position === 0;
  el('review-next').disabled = position === count;
  el('review-return').textContent = demo ? '返回原局面' : '回到最新一步';
  el('analyze-review').hidden = Boolean(demo);
  el('analyze-review').disabled = !canAnalyze();
}

function syncBoard(animation = null, duration = 390) {
  const ply = reviewBase();
  const demoMove = demo?.line[demo.step - 1];
  shownMove = demoMove ?? history[ply - 1] ?? null;
  shownPosition = !demoMove && ply === history.length ? game : new Chess(shownMove?.after);
  pieces = shownPosition.board().flat().filter(Boolean);
  piecesBySquare = new Map(pieces.map(piece => [piece.square, piece]));
  renderFlatPieces();
  const animate = animation && !reducedMotion.matches && !canvas.hidden;
  board3d?.setBoard(pieces, settings.flipped, animation, animate ? duration : 0);
  renderMarks();
  renderMatch();
  renderReview();
}

function syncPosition(move = null, duration = 390) {
  result = getResult();
  if (move && isReviewing()) {
    renderMatch();
    renderReview();
  } else syncBoard(move, duration);
  renderHistory(true);
}

function revealReview() {
  const panel = el('board-stage');
  if (narrow.matches && panel.getBoundingClientRect().top < 0) panel.scrollIntoView({ block: 'start' });
}

function setReplay(ply, { reveal = false, move = null } = {}) {
  finish3dGesture();
  replayPly = ply < history.length ? Math.max(0, ply) : null;
  demo = null;
  clearSelection();
  hint = null;
  syncBoard(move);
  renderHistory();
  if (reveal) revealReview();
}

function stepReview(direction) {
  if (demo) {
    const target = Math.max(0, Math.min(demo.line.length, demo.step + direction));
    if (target === demo.step) return;
    demo.step = target;
    syncBoard(direction > 0 ? demo.line[target - 1] : null);
    return;
  }
  if (replayPly === null) return;
  const target = Math.max(0, Math.min(history.length, replayPly + direction));
  if (target === replayPly) return;
  setReplay(target, { move: direction > 0 ? history[target - 1] : null });
}

function positionMatchControls() {
  const status = el('match-status');
  const undo = el('undo');
  if (narrow.matches) {
    el('board-activity').append(status, undo);
  } else {
    el('match-status-slot').append(status);
    el('match-actions').prepend(undo);
  }
  renderReview();
}

function announceSquare() {
  const description = describeSquare(focusSquare);
  el('square-announcement').textContent = selected ? `${description}，已选 ${selected}` : description;
}

function clearSelection() {
  selected = null;
  legal = [];
}

function select(square) {
  if (!canPlay()) return;
  const piece = piecesBySquare.get(square);
  const options = legal.filter(move => move.to === square);
  hint = null;
  if (options.length) {
    prepareMove(options);
    return;
  }
  if (square !== selected && piece?.color === game.turn()) {
    selected = square;
    legal = game.moves({ square, verbose: true });
  } else clearSelection();
  renderMarks();
}

function prepareMove(options, drop = false) {
  if (options.length === 1) {
    play(options[0], { drop });
    return;
  }
  pendingPromotion = options;
  const container = el('promotion-options');
  container.replaceChildren(...options.map(move => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button secondary';
    button.append(imageFor(move.color, move.promotion), document.createTextNode(names[move.promotion]));
    button.addEventListener('click', () => {
      pendingPromotion = null;
      promotionDialog.close();
      play(move);
    });
    return button;
  }));
  promotionDialog.showModal();
  container.firstElementChild.focus();
}

function play(action, { byComputer = false, drop = false } = {}) {
  const move = game.move({ from: action.from, to: action.to, promotion: action.promotion });
  history.push(move);
  clearSelection();
  hint = null;
  if (!byComputer) focusSquare = move.to;
  if (!byComputer && keyboardFocus && !el('flat-wrap').hidden) tiles.get(focusSquare)?.focus();
  syncPosition(move, drop ? 145 : 390);
  save();
  if (!byComputer && keyboardFocus && !canvas.hidden) announceSquare();
  if (!isReviewing()) playSound(Boolean(move.captured));
  if (!byComputer) queueComputer();
}

function stopWork() {
  if (replyTimer) clearTimeout(replyTimer);
  replyTimer = 0;
  cancelComputer?.();
  cancelComputer = null;
  stopAnalysis();
}

function stopAnalysis() {
  cancelAnalysis?.();
  cancelAnalysis = null;
}

function runEngine(analysis, prefix, callback) {
  const payload = { moves: prefix.map(move => move.san), analysis, level: settings.level };
  let worker;
  let active = true;
  let fallingBack = false;
  const cancel = () => {
    active = false;
    worker?.terminate();
  };
  const complete = outcome => {
    if (!active) return;
    cancel();
    callback(outcome);
  };
  const fallback = async () => {
    if (!active || fallingBack) return;
    fallingBack = true;
    worker?.terminate();
    try {
      const { search } = await import('./engine.mjs');
      if (active) complete(search({ ...payload, quick: true, level: 'easy' }));
    } catch {
      complete(null);
    }
  };
  try {
    worker = new Worker(new URL('./engine-worker.mjs', import.meta.url), { type: 'module' });
    worker.addEventListener('message', ({ data }) => {
      if (data.error) void fallback();
      else complete(data.result);
    }, { once: true });
    worker.addEventListener('error', event => {
      event.preventDefault();
      void fallback();
    }, { once: true });
    worker.postMessage(payload);
  } catch {
    void fallback();
  }
  return cancel;
}

function queueComputer() {
  if (!isComputerTurn() || cancelComputer || replyTimer) return;
  const start = performance.now();
  cancelComputer = runEngine(false, history, choice => {
    cancelComputer = null;
    replyTimer = setTimeout(() => {
      replyTimer = 0;
      if (!isComputerTurn()) return;
      const moves = game.moves({ verbose: true });
      const candidate = choice?.move;
      const matching = candidate && moves.find(move => move.from === candidate.from && move.to === candidate.to && move.promotion === candidate.promotion);
      const move = matching || moves[0];
      if (move) play(move, { byComputer: true });
    }, Math.max(55, 670 - (performance.now() - start)));
  });
}

function undo() {
  if (el('undo').disabled) return;
  finish3dGesture();
  stopWork();
  let move = game.undo();
  history.pop();
  if (settings.mode === 'computer' && move.color !== settings.color) {
    move = game.undo();
    history.pop();
  }
  focusSquare = move.from;
  hint = null;
  clearSelection();
  syncPosition();
  save();
  queueComputer();
}

function showToast(message) {
  clearTimeout(toastTimer);
  const toast = el('toast');
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 2700);
}

function applyView() {
  const show3d = settings.view === '3d' && board3d && !failed3d;
  canvas.hidden = !show3d;
  el('flat-wrap').hidden = Boolean(show3d);
  el('view-3d').setAttribute('aria-pressed', String(Boolean(show3d)));
  el('view-2d').setAttribute('aria-pressed', String(!show3d));
  el('view-3d').disabled = failed3d;
  el('view-3d').title = failed3d ? '当前浏览器无法启用 WebGL 2' : '';
  renderReview();
  if (show3d) board3d.resize();
}

function lose3d() {
  if (failed3d) return;
  finish3dGesture(false, 0);
  failed3d = true;
  const wasVisible = settings.view === '3d';
  applyView();
  if (wasVisible) showToast('立体视角暂不可用，已切换到俯视。');
}

async function setView(view) {
  finish3dGesture(false, 0);
  settings.view = view;
  save();
  keyboardFocus = false;
  if (view === '3d' && !board3d && !failed3d) {
    preparing3d ??= import('./board3d.mjs').then(({ Board3D }) => {
      board3d = new Board3D(canvas);
      canvas.addEventListener('webglcontextlost', lose3d);
      board3d.setBoard(pieces, settings.flipped);
      renderMarks();
    }).catch(lose3d);
    await preparing3d;
  }
  applyView();
}

function flip() {
  finish3dGesture(false, 0);
  settings.flipped = !settings.flipped;
  buildFlatBoard();
  renderFlatPieces();
  board3d?.setBoard(pieces, settings.flipped);
  renderMarks();
  renderMatch();
  save();
}

function changeFocus(event, perspective) {
  const movements = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (isReviewing() && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) return;
  const offset = movements[event.key];
  if (offset) {
    event.preventDefault();
    keyboardFocus = true;
    const [columns, rows] = boardAxes();
    const x = Math.max(0, Math.min(7, columns.indexOf(focusSquare[0]) + offset[0]));
    const y = Math.max(0, Math.min(7, rows.indexOf(focusSquare[1]) + offset[1]));
    focusSquare = columns[x] + rows[y];
    if (perspective) announceSquare();
    else tiles.get(focusSquare).focus();
    renderMarks();
  } else if (event.key === 'Escape') {
    finish3dGesture();
    clearSelection();
    hint = null;
    renderMarks();
  } else if (perspective && (event.key === ' ' || event.key === 'Enter')) {
    event.preventDefault();
    keyboardFocus = true;
    select(focusSquare);
    announceSquare();
  }
}

function ownSquare(pick) {
  return [pick.piece, pick.tile].find(square => piecesBySquare.get(square)?.color === game.turn());
}

function pickTarget(pick, candidates) {
  return [pick.piece, pick.tile].find(square => candidates.some(move => move.to === square));
}

function finish3dGesture(commit = false, duration = 150) {
  const gesture = picked3d;
  if (!gesture) return;
  picked3d = null;
  delete canvas.dataset.held;
  if (canvas.hasPointerCapture(gesture.id)) canvas.releasePointerCapture(gesture.id);
  board3d.release(commit, reducedMotion.matches ? 0 : duration);
}

canvas.addEventListener('pointerdown', event => {
  if (event.button !== 0 || !event.isPrimary || !canPlay() || picked3d) return;
  keyboardFocus = false;
  const picked = board3d.pick(event.clientX, event.clientY);
  const source = ownSquare(picked);
  const held = Boolean(source && board3d.hold(source, event.clientX, event.clientY));
  const candidates = held ? game.moves({ square: source, verbose: true }) : [];
  picked3d = {
    id: event.pointerId, x: event.clientX, y: event.clientY, source, held, candidates,
    destinations: new Set(candidates.map(move => move.to)), target: null, dragged: false,
  };
  canvas.setPointerCapture(event.pointerId);
  if (held) {
    canvas.dataset.held = '';
    renderMarks();
  }
});
canvas.addEventListener('pointermove', event => {
  const gesture = picked3d;
  if (!gesture?.held || gesture.id !== event.pointerId) return;
  gesture.dragged ||= Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 6;
  const target = board3d.drag(event.clientX, event.clientY, gesture.destinations);
  if (target !== gesture.target) {
    gesture.target = target;
    renderMarks();
  }
});
canvas.addEventListener('pointerup', event => {
  if (picked3d?.id !== event.pointerId) return;
  const gesture = picked3d;
  if (!canPlay()) {
    finish3dGesture();
    renderMarks();
    return;
  }
  const dragged = gesture.dragged || Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 6;
  if (dragged && gesture.held) {
    const target = board3d.drag(event.clientX, event.clientY, gesture.destinations);
    const candidates = gesture.candidates.filter(move => move.to === target);
    const drop = candidates.length === 1;
    finish3dGesture(drop);
    if (candidates.length) {
      selected = gesture.source;
      legal = gesture.candidates;
      hint = null;
      if (!drop) renderMarks();
      prepareMove(candidates, drop);
      return;
    }
    selected = gesture.source;
    focusSquare = gesture.source;
    legal = gesture.candidates;
    hint = null;
    renderMarks();
    return;
  }
  finish3dGesture(false, 0);
  if (dragged) return;
  const pick = board3d.pick(event.clientX, event.clientY);
  const square = pickTarget(pick, legal) || gesture.source || ownSquare(pick) || pick.tile || pick.piece;
  if (square) focusSquare = square;
  select(square);
});
for (const eventType of ['pointercancel', 'lostpointercapture']) {
  canvas.addEventListener(eventType, event => {
    if (picked3d?.id !== event.pointerId) return;
    finish3dGesture();
    renderMarks();
  });
}
canvas.addEventListener('keydown', event => changeFocus(event, true));
canvas.addEventListener('focus', () => {
  keyboardFocus = canvas.matches(':focus-visible');
  renderMarks();
});
canvas.addEventListener('blur', () => { keyboardFocus = false; renderMarks(); });

let picked2d = null;
let skipFlatClick = 0;
flatBoard.addEventListener('pointerdown', event => {
  if (event.button !== 0 || !event.isPrimary || !canPlay()) return;
  const source = event.target.closest('.tile')?.dataset.square;
  if (piecesBySquare.get(source)?.color !== game.turn()) return;
  keyboardFocus = false;
  picked2d = { id: event.pointerId, source, x: event.clientX, y: event.clientY };
});
document.addEventListener('pointerup', event => {
  if (picked2d?.id !== event.pointerId) return;
  const start = picked2d;
  picked2d = null;
  if (!canPlay() || Math.hypot(event.clientX - start.x, event.clientY - start.y) <= 8) return;
  skipFlatClick = performance.now() + 160;
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('.tile')?.dataset.square;
  const candidates = game.moves({ square: start.source, verbose: true }).filter(move => move.to === target);
  if (candidates.length) prepareMove(candidates);
  else if (selected !== start.source) select(start.source);
});
flatBoard.addEventListener('pointercancel', () => { picked2d = null; });
flatBoard.addEventListener('click', event => {
  if (event.detail && performance.now() < skipFlatClick) return;
  const square = event.target.closest('.tile')?.dataset.square;
  if (!square) return;
  keyboardFocus = event.detail === 0;
  focusSquare = square;
  select(square);
});
flatBoard.addEventListener('keydown', event => changeFocus(event, false));

function updateNewForm() {
  const local = newForm.elements.mode.value === 'local';
  el('computer-settings').hidden = local;
  for (const input of el('computer-settings').querySelectorAll('input')) input.disabled = local;
}

el('new-game').addEventListener('click', () => {
  finish3dGesture();
  renderMarks();
  newForm.elements.mode.value = settings.mode;
  newForm.elements.color.value = settings.color;
  newForm.elements.level.value = settings.level;
  el('replace-note').hidden = !history.length;
  el('replace-confirm').hidden = true;
  el('start-match').textContent = '开始对局';
  updateNewForm();
  newDialog.showModal();
});
newForm.addEventListener('change', updateNewForm);
newForm.addEventListener('submit', event => {
  event.preventDefault();
  if (history.length && !notebook.isSaved(matchId, history.map(move => move.san)) && el('replace-confirm').hidden) {
    el('replace-confirm').hidden = false;
    el('start-match').textContent = '继续开始新对局';
    el('replace-cancel').focus();
    return;
  }
  stopWork();
  const form = new FormData(newForm);
  const mode = form.get('mode');
  settings = { ...settings, mode, color: form.get('color') ?? 'w', level: form.get('level') ?? settings.level };
  settings.flipped = mode === 'computer' && settings.color === 'b';
  focusSquare = settings.flipped ? 'e7' : 'e2';
  game = new Chess();
  history = [];
  matchId = newMatchId();
  replayPly = null;
  demo = null;
  hint = null;
  clearSelection();
  buildFlatBoard();
  newDialog.close();
  syncPosition();
  save();
  queueComputer();
});
el('replace-cancel').addEventListener('click', () => {
  el('replace-confirm').hidden = true;
  el('start-match').textContent = '开始对局';
  newDialog.close();
});

function reasonFor(move, before, after, choice) {
  if (after.isCheckmate()) return '这一步会直接将死。';
  if (before.isCheck()) {
    if (move.captured) return `吃掉对方的${names[move.captured]}，同时解除将军。`;
    return move.piece === 'k' ? '移开王，解除将军。' : '挡住对方的攻击路线，解除将军。';
  }
  if (choice.mateIn) {
    const winner = choice.score > 0 ? 'w' : 'b';
    return move.color === winner ? '按当前搜索，这一步可以进入强制将死的变化。' : '对手有强制将死的走法，这一步能延缓被将死。';
  }
  if (move.promotion) return `兵升变为${names[move.promotion]}，改变双方子力。`;
  if (move.flags.includes('q') || move.flags.includes('k')) return '易位将王移离中心，同时让车更容易加入战斗。';
  if (after.isCheck()) return '这一步会将军，对方要先解除将军。';
  if (move.captured) return `这一步可以吃掉对方的${names[move.captured]}。`;
  const center = ['d4', 'e4', 'd5', 'e5'].filter(square => (
    after.attackers(square, move.color).includes(move.to) && !before.attackers(square, move.color).includes(move.from)
  ));
  if (center.length) return `走完后，${colors[move.color]}${names[move.piece]}会控制中心格 ${center.join('、')}。`;
  return '按当前搜索，这是引擎评估最高的走法。';
}

function describeProtection(saved) {
  const piece = colors[saved.piece.color] + names[saved.piece.type];
  const attacker = colors[saved.threat.color] + names[saved.threat.piece];
  if (saved.from !== saved.to) return `把 ${saved.from} 受威胁的${piece}撤到 ${saved.to}，避开${attacker}原来的吃子。`;
  if (saved.recapture) return `护住了 ${saved.to} 的${piece}。对方若吃它，可以用${names[saved.recapture.piece]}回吃。`;
  return `护住了 ${saved.to} 的${piece}，化解${attacker}从 ${saved.threat.from} 直接吃子的威胁。`;
}

function responseReason(move) {
  if (move.san.endsWith('#')) return move.color === 'w' ? '黑方会被将死。' : '白方会被将死。';
  if (move.san.endsWith('+')) return '对方将军，下一步必须解将。';
  if (move.captured) return `对方这样可以吃到${names[move.captured]}。`;
  const before = new Chess(move.before);
  const after = new Chess(move.after);
  const target = after.board().flat().find(piece => (
    piece && piece.color !== move.color && piece.type !== 'k'
    && after.attackers(piece.square, move.color).includes(move.to)
    && !before.attackers(piece.square, move.color).includes(move.from)
  ));
  return target ? `这步会给 ${target.square} 的${colors[target.color]}${names[target.type]}施压。` : '';
}

function renderAnalysis(choice, source) {
  if (!analysisDialog.open) return;
  el('analysis-loading').hidden = true;
  if (!choice?.move) {
    el('analysis-message').textContent = '当前局面暂时无法分析。';
    el('analysis-message').hidden = false;
    return;
  }
  const before = new Chess(source.fen);
  const position = new Chess(source.fen);
  const line = (choice.line ?? [choice.move]).map(action => position.move(action));
  const [move, reply] = line;
  const after = new Chess(move.after);
  const saved = findSavedPiece(before, after, move);
  if (saved) saved.note = describeProtection(saved);
  analyzed = { basePly: source.ply, line, saved };
  const { score, mateIn, depth } = choice;
  const side = score >= 0 ? '白方' : '黑方';
  el('evaluation-label').textContent = mateIn ? `${side}有强制将死` : Math.abs(score) < 32 ? '大致均势' : `${side}${Math.abs(score) < 140 ? '略占优' : '占优'}`;
  el('evaluation-score').textContent = mateIn ? `${mateIn} 步杀` : `${score > 0 ? '+' : ''}${(score / 100).toFixed(2)}`;
  el('eval-white').style.width = `${50 + 47 * Math.tanh(score / 580)}%`;
  el('recommendation-san').textContent = move.san;
  el('recommendation-move').textContent = describeMove(move);
  const reason = saved ? saved.note + (after.isCheck() ? '同时将军，对方要先解将。' : '') : reasonFor(move, before, after, choice);
  el('recommendation-reason').textContent = reason;
  el('response').hidden = !reply;
  if (reply) {
    el('response-san').textContent = reply.san;
    el('response-move').textContent = describeMove(reply);
    const reason = responseReason(reply);
    el('response-reason').textContent = reason;
    el('response-reason').hidden = !reason;
  }
  el('analysis-depth').textContent = `${depth} 层搜索 · 正值代表白方占优，负值代表黑方占优`;
  el('analysis-result').hidden = false;
}

function startAnalysis() {
  if (!canAnalyze()) return;
  finish3dGesture();
  renderMarks();
  const source = { ply: reviewBase(), fen: shownPosition.fen() };
  stopAnalysis();
  analyzed = null;
  el('analysis-loading').hidden = false;
  el('analysis-message').hidden = true;
  el('analysis-result').hidden = true;
  analysisDialog.showModal();
  cancelAnalysis = runEngine(true, history.slice(0, source.ply), choice => {
    cancelAnalysis = null;
    renderAnalysis(choice, source);
  });
}

el('analysis').addEventListener('click', startAnalysis);
el('analyze-review').addEventListener('click', startAnalysis);
el('show-hint').addEventListener('click', () => {
  if (!analyzed) return;
  hint = analyzed.line[0];
  clearSelection();
  analysisDialog.close();
  renderMarks();
  revealReview();
});
el('show-variation').addEventListener('click', () => {
  if (!analyzed) return;
  demo = { ...analyzed, step: 1 };
  hint = null;
  clearSelection();
  analysisDialog.close();
  syncBoard(demo.line[0]);
  renderHistory();
  revealReview();
  const control = el(demo.line.length > 1 ? 'review-next' : 'review-return');
  control.focus({ preventScroll: true });
});
analysisDialog.addEventListener('close', () => { if (!analysisDialog.open) stopAnalysis(); });
promotionDialog.addEventListener('close', () => { pendingPromotion = null; });

el('move-list').addEventListener('click', event => {
  const button = event.target.closest('[data-ply]');
  if (button) setReplay(Number(button.dataset.ply), { reveal: true });
});
el('review-open').addEventListener('click', () => {
  setReplay(0, { reveal: true });
  el('review-next').focus({ preventScroll: true });
});
el('review-previous').addEventListener('click', () => stepReview(-1));
el('review-next').addEventListener('click', () => stepReview(1));
el('review-return').addEventListener('click', () => {
  if (demo) {
    demo = null;
    syncBoard();
    renderHistory();
  } else setReplay(history.length);
  const control = replayPly !== null ? el('analyze-review') : canvas.hidden ? tiles.get(focusSquare) : canvas;
  control?.focus({ preventScroll: true });
});
document.addEventListener('keydown', event => {
  if (el('screen-play').hidden || !isReviewing() || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || document.querySelector('dialog[open]')) return;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    stepReview(event.key === 'ArrowLeft' ? -1 : 1);
  }
});

function updateSound() {
  soundButton.setAttribute('aria-pressed', String(settings.sound));
  soundButton.querySelector('use').setAttribute('href', settings.sound ? '#i-volume' : '#i-muted');
}

function playSound(capture = false) {
  if (!settings.sound) return;
  try {
    audio ??= new AudioContext();
    if (audio.state !== 'running') void audio.resume().catch(() => {});
    const time = audio.currentTime + .005;
    const tap = audio.createOscillator();
    const volume = audio.createGain();
    tap.type = 'triangle';
    tap.frequency.setValueAtTime(capture ? 340 : 490, time);
    tap.frequency.exponentialRampToValueAtTime(145, time + .073);
    volume.gain.setValueAtTime(.075, time);
    volume.gain.exponentialRampToValueAtTime(.001, time + .083);
    tap.connect(volume).connect(audio.destination);
    tap.start(time);
    tap.stop(time + .09);
  } catch {
    // Audio support is optional.
  }
}

soundButton.addEventListener('click', () => {
  settings.sound = !settings.sound;
  updateSound();
  save();
  if (settings.sound) playSound();
});
for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', () => button.closest('dialog').close());
el('rules').addEventListener('click', () => {
  finish3dGesture();
  renderMarks();
  el('rules-dialog').showModal();
});
el('copy').addEventListener('click', () => {
  void copyPgn(game, { ...settings, result: result?.pgn ?? '*' }, showToast);
});
el('download-pgn').addEventListener('click', () => downloadPgn(game, { ...settings, result: result?.pgn ?? '*' }, showToast));
el('undo').addEventListener('click', undo);
el('view-3d').addEventListener('click', () => { void setView('3d'); });
el('view-2d').addEventListener('click', () => { void setView('2d'); });
el('flip').addEventListener('click', flip);

const notebook = initNotebook(() => ({
  id: matchId,
  mode: settings.mode,
  color: settings.color,
  level: settings.level,
  moves: history.map(move => move.san),
  result: result ? { pgn: result.pgn, title: result.title } : { pgn: '*', title: '' },
}), showToast);
const sections = [...document.querySelectorAll('[data-section]')];
let tacticsInitialized = false;

function showSection() {
  const target = ['records', 'tactics'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'play';
  finish3dGesture(false, 0);
  for (const link of sections) {
    const name = link.dataset.section;
    el(`screen-${name}`).hidden = name !== target;
    if (name === target) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  if (target === 'records') notebook.refresh();
  if (target === 'tactics' && !tacticsInitialized) {
    initTacticsBook();
    tacticsInitialized = true;
  }
  if (target === 'play') {
    board3d?.resize();
    renderMarks();
  }
}

window.addEventListener('hashchange', () => {
  showSection();
  window.scrollTo(0, 0);
});

buildFlatBoard();
positionMatchControls();
narrow.addEventListener('change', positionMatchControls);
syncPosition();
updateSound();
applyView();
void setView(settings.view);
queueComputer();
showSection();
