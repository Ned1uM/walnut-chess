import { lessons } from './lessons.mjs';
import { makeLine, Study } from './study.mjs';

export function initTacticsBook() {
  const list = document.getElementById('lesson-list');
  const filters = [...document.querySelectorAll('[data-lesson-kind]')];
  const note = document.getElementById('lesson-note');
  const sources = { tactic: 'https://lichess.org/practice', opening: 'https://github.com/lichess-org/chess-openings' };
  const categories = { tactic: '战术', opening: '开局' };
  let selection;
  const study = new Study('lesson', (ply) => {
    const move = study.line.steps[ply - 1];
    note.textContent = selection.notes[ply] ?? (move?.color === 'w'
      ? '留意这一步争夺的中心格，以及它为后续棋子打开的路线。'
      : '留意黑方新打开的出子路线，以及它如何应对白方的中心。');
  });

  function select(lesson) {
    selection = lesson;
    document.getElementById('lesson-title').textContent = lesson.title;
    document.getElementById('lesson-meta').textContent = lesson.topic;
    document.getElementById('lesson-intro').textContent = lesson.intro;
    const source = document.getElementById('lesson-source');
    source.href = sources[lesson.kind];
    source.textContent = `Lichess ${categories[lesson.kind]}资料`;
    for (const button of list.querySelectorAll('button')) {
      if (button.dataset.lesson === lesson.id) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
    }
    study.setLine(makeLine(lesson.moves, lesson.fen));
  }

  function showCategory(kind) {
    const entries = lessons.filter(lesson => lesson.kind === kind);
    for (const button of filters) button.setAttribute('aria-pressed', String(button.dataset.lessonKind === kind));
    list.replaceChildren(...entries.map(lesson => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'book-entry';
      button.dataset.lesson = lesson.id;
      const title = document.createElement('strong');
      title.textContent = lesson.title;
      const topic = document.createElement('span');
      topic.textContent = lesson.topic;
      button.append(title, topic);
      button.addEventListener('click', () => select(lesson));
      return button;
    }));
    select(entries[0]);
  }

  for (const button of filters) button.addEventListener('click', () => showCategory(button.dataset.lessonKind));
  const tactical = lessons.filter(lesson => lesson.kind === 'tactic').length;
  document.getElementById('lesson-count').textContent = `${tactical} 个战术示范 · ${lessons.length - tactical} 个开局`;
  showCategory('tactic');
}
