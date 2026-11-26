import { names, sideNames } from './chess-ui.mjs';

const el = id => document.getElementById(id);
const round = moment => Math.ceil(moment.ply / 2);

function reason(moment) {
  if (moment.kind === 'allowed-mate') return '给了对手强制将杀的机会';
  if (moment.kind === 'missed-mate') return '错过了引擎找到的强制将杀';
  if (moment.replyCapture) return `对方可走 ${moment.reply}，吃掉${names[moment.replyCapture]}`;
  if (moment.replyCheck) return `对方可走 ${moment.reply} 将军`;
  if (moment.mate) return '在强制将杀的变化中失去先机';
  return `引擎估算少了约 ${(moment.loss / 100).toFixed(1)} 兵的优势`;
}

function adviceFor(report, color = null) {
  const chosen = (color ? report.moments.filter(moment => moment.color === color) : report.moments);
  const top = chosen[0];
  if (!top) return [
    color ? '这局执棋一方没有被标出的明显失误。可以回看开局，检查棋子是否尽快发展、王是否安全。'
      : '这局没有检测到明显的局势落差。回放若干关键回合，试着在实战走法前说出对手的下一步计划。',
  ];
  const advice = [`先回放第 ${round(top)} 回合，比较 ${top.san} 和 ${top.suggested} 后对手的选择。`];
  if (chosen.some(moment => moment.kind === 'allowed-mate')) {
    advice.push('落子前先扫一遍对手的将军。王贴着底线时，尤其要确认有退格或棋子能挡住攻击。');
  } else if (chosen.some(moment => moment.kind === 'missed-mate')) {
    advice.push('看到对方的王缺少退路时，先逐个检查己方的将军，并算清对方能否挡、吃或逃。');
  } else if (chosen.some(moment => moment.replyCapture)) {
    advice.push('每走一步，都检查移开的棋子原来守着什么。遇到换子，至少算到对方的第一次回吃。');
  } else if (chosen.some(moment => moment.replyCheck)) {
    advice.push('提前想好对手将军时怎么应对。可以在候选走法中优先找能同时护王和出子的走法。');
  } else {
    advice.push('比较两着棋时，各给对手找一个最强回应，再判断哪一着能留下更好的后续。');
  }
  return advice;
}

export function drawReportChart(canvas, report) {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height || report.scores.length < 2) return;
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext('2d');
  ctx.scale(ratio, ratio);
  const padding = 12;
  const middle = height / 2;
  const x = i => padding + (width - 2 * padding) * i / (report.scores.length - 1);
  const y = score => middle - Math.tanh(score / 475) * (middle - padding);
  ctx.strokeStyle = '#668074';
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(padding, middle);
  ctx.lineTo(width - padding, middle);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = '#e3c58f';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  report.scores.forEach((score, ply) => {
    if (ply === 0) ctx.moveTo(x(ply), y(score));
    else ctx.lineTo(x(ply), y(score));
  });
  ctx.stroke();
  for (const moment of report.moments) {
    const score = report.scores[moment.ply];
    ctx.beginPath();
    ctx.fillStyle = '#ef9a79';
    ctx.arc(x(moment.ply), y(score), 3.2, 0, 2 * Math.PI);
    ctx.fill();
  }
}

export function renderReport(record, report, onMoment) {
  const { moments, counts } = report;
  const top = moments[0];
  const result = record.result.title ? `${record.result.title}。` : '保存时对局仍在进行。';
  const turningPoint = top
    ? `最大变化出现在第 ${round(top)} 回合，${sideNames[top.color]}的 ${top.san} ${reason(top)}。建议走 ${top.suggested}。`
    : '按当前搜索深度，这段走法没有明显的局势落差。';
  el('report-summary').textContent = `${result}共分析 ${report.scanned} 步，白方 ${counts.w} 步、黑方 ${counts.b} 步值得回看。${turningPoint}`;
  el('report-moments-wrap').hidden = !moments.length;
  el('report-moments').replaceChildren(...moments.map(moment => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'moment-button';
    const line = document.createElement('strong');
    line.textContent = `第 ${round(moment)} 回合 · ${sideNames[moment.color]} ${moment.san}`;
    const alternative = document.createElement('span');
    alternative.textContent = `${reason(moment)}。建议 ${moment.suggested}${moment.counter ? `，预计应对 ${moment.counter}` : ''}。`;
    button.append(line, alternative);
    button.addEventListener('click', () => onMoment(moment));
    return button;
  }));
  const focus = record.mode === 'computer' ? record.color : null;
  el('report-advice').replaceChildren(...adviceFor(report, focus).map(text => {
    const item = document.createElement('li');
    item.textContent = text;
    return item;
  }));
}
