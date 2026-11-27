import { copyPgn, downloadPgn, levels, sideNames } from './chess-ui.mjs';
import { makeLine, Study } from './study.mjs';
import { drawReportChart, renderReport } from './report-view.mjs';
import { createNotebookStore, localRecords } from './notebook-store.mjs';

const el = id => document.getElementById(id);
const dateFormat = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
});

function lineKey(record) {
  return record.moves.join(' ');
}

function metadata(record) {
  const mode = record.mode === 'local' ? '同屏双人'
    : `${sideNames[record.color]}对电脑 · ${levels[record.level] ?? '标准'}`;
  return `${mode} · ${record.moves.length} 步 · ${record.result.title || '进行中'}`;
}

function usableReport(record) {
  const report = record?.report;
  return report?.version === 1 && report.scanned === record.moves.length
    && Array.isArray(report.moments) && Array.isArray(report.scores) ? report : null;
}

export function initNotebook(snapshot, toast) {
  const saveDialog = el('save-dialog');
  const chart = el('report-chart');
  const list = el('record-list');
  const store = createNotebookStore();
  const jobs = new Map();
  const errors = new Map();
  let records = [];
  let selected = null;
  let pendingSave = null;
  let refreshing = null;
  let openingSave = false;
  const study = new Study('record', (ply, hint) => {
    const description = el('record-hint');
    description.hidden = !hint;
    description.textContent = hint
      ? `实战走了 ${hint.san}。高亮的是建议走法 ${hint.suggested}${hint.counter ? `，对手预计回应 ${hint.counter}` : ''}。`
      : '';
  });
  new ResizeObserver(() => {
    const report = usableReport(selected);
    if (report) drawReportChart(chart, report);
  }).observe(chart);

  async function refresh(preferred = selected?.id) {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      try {
        const result = await store.load();
        records = result.entries.sort((a, b) => b.savedAt - a.savedAt);
        el('record-count').textContent = `已保存 ${records.length} 局 · 已同步到账号`;
        if (result.partialImport) {
          el('record-count').textContent += ' · 部分旧棋谱无法导入，仍保留在此浏览器';
          if (!result.volatile) toast('部分旧棋谱无法导入，原数据仍保留在此浏览器。');
        }
        if (result.volatile) {
          el('record-count').textContent += ' · 有棋谱仅保留在当前页面，尚未同步';
          toast('有棋谱尚未同步，仅保留在当前页面；请勿刷新，联网后重试。');
        }
        else if (result.pending && !result.partialImport) toast('有尚未同步的棋谱保存在此浏览器，请重新保存该局。');
        render(preferred);
        return true;
      } catch {
        if (!records.length) records = localRecords().sort((a, b) => b.savedAt - a.savedAt);
        render(preferred);
        el('record-count').textContent = '暂时无法同步，显示此浏览器中可用的棋谱';
        toast('棋谱本同步失败，请检查网络或登录状态。');
        return false;
      }
    })();
    try { return await refreshing; } finally { refreshing = null; }
  }
  function render(preferred = selected?.id) {
    el('notebook-empty').hidden = Boolean(records.length);
    el('notebook-layout').hidden = !records.length;
    for (const [id, job] of jobs) {
      const record = records.find(entry => entry.id === id);
      if (!record || lineKey(record) !== job.line) {
        job.worker.terminate();
        jobs.delete(id);
      }
    }
    if (!records.length) {
      selected = null;
      return;
    }
    const focusId = list.contains(document.activeElement) ? document.activeElement.dataset.record : null;
    list.replaceChildren(...records.map(record => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'book-entry';
      button.dataset.record = record.id;
      const title = document.createElement('strong');
      title.textContent = record.title;
      const detail = document.createElement('span');
      detail.textContent = `${record.moves.length} 步 · ${dateFormat.format(record.savedAt)}`;
      button.append(title, detail);
      button.addEventListener('click', () => select(record));
      if (record.id === focusId) queueMicrotask(() => button.focus({ preventScroll: true }));
      return button;
    }));
    select(records.find(record => record.id === preferred) ?? records[0]);
  }

  function select(record) {
    const changed = selected?.id !== record.id || lineKey(selected) !== lineKey(record);
    selected = record;
    for (const button of list.querySelectorAll('[data-record]')) {
      if (button.dataset.record === record.id) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
    }
    el('record-title').textContent = record.title;
    el('record-meta').textContent = metadata(record);
    if (changed) {
      study.setLine(makeLine(record.moves), {
        flipped: record.mode === 'computer' && record.color === 'b',
        ply: record.moves.length,
      });
    }
    showReport();
  }

  function showReport() {
    if (!selected) return;
    const report = usableReport(selected);
    const job = jobs.get(selected.id);
    const error = errors.get(selected.id);
    el('record-report').hidden = !(report || job || error);
    el('report-ready').hidden = !report;
    el('report-cancel').hidden = !job;
    el('report-progress').hidden = !job;
    el('record-analyze').disabled = Boolean(job);
    el('record-analyze').querySelector('span').textContent = job ? '分析中' : report ? '查看复盘' : 'AI 复盘';
    if (job) {
      const { stage, done, total } = job;
      el('report-progress').max = total || 1;
      el('report-progress').value = done;
      el('report-status').textContent = stage === 'refine'
        ? `复查关键局面 ${done} / ${total}` : `分析整局 ${done} / ${total} 步`;
    } else if (report) {
      el('report-status').textContent = '比较实战与推荐走法 · 由棋力引擎估算';
      renderReport(selected, report, moment => {
        study.go(moment.ply - 1, moment);
        el('record-detail').scrollIntoView({ block: 'start' });
        el('record-board').focus({ preventScroll: true });
      });
      drawReportChart(chart, report);
    } else {
      el('report-status').textContent = error || '';
    }
  }

  async function analyze() {
    if (!selected || jobs.has(selected.id)) return;
    if (!await refresh(selected.id) || !selected || jobs.has(selected.id)) return;
    if (usableReport(selected)) {
      el('record-report').scrollIntoView({ block: 'start' });
      return;
    }
    const { id, moves } = selected;
    errors.delete(id);
    let worker;
    try {
      worker = new Worker(new URL('./report-worker.mjs', import.meta.url), { type: 'module' });
    } catch {
      errors.set(id, '当前浏览器暂时无法启动复盘引擎。');
      showReport();
      return;
    }
    const job = { worker, line: lineKey(selected), stage: 'scan', done: 0, total: moves.length };
    jobs.set(id, job);
    const finish = async (message, report) => {
      if (jobs.get(id) !== job) return;
      jobs.delete(id);
      worker.terminate();
      if (report) {
        const entry = records.find(record => record.id === id);
        if (entry && lineKey(entry) === job.line) {
          try {
            const updated = { ...entry, report };
            await store.save(updated);
            await refresh(id);
          } catch (error) {
            const message = error.volatile ? '复盘结果尚未同步，仅保留在当前页面；请勿刷新，联网后重试。' : '复盘结果尚未同步，请检查网络后重试。';
            errors.set(id, message);
            toast(message);
            if (selected?.id === id) showReport();
          }
        }
        return;
      }
      errors.set(id, message);
      if (selected?.id === id) showReport();
    };
    worker.addEventListener('message', ({ data }) => {
      if (jobs.get(id) !== job) return;
      if (data.kind === 'progress') {
        Object.assign(job, { stage: data.stage, done: data.done, total: data.total });
        if (selected?.id === id) showReport();
      } else if (data.kind === 'ready') finish(null, data.report);
      else finish('棋谱分析遇到问题，可以重试。');
    });
    worker.addEventListener('error', event => {
      event.preventDefault();
      finish('复盘引擎加载失败，可以重试。');
    });
    worker.postMessage({ moves });
    showReport();
    el('record-report').scrollIntoView({ block: 'start' });
  }

  el('save-record').addEventListener('click', async () => {
    if (openingSave || saveDialog.open) return;
    openingSave = true;
    pendingSave = snapshot();
    if (!pendingSave.moves.length) { openingSave = false; return; }
    if (!await refresh()) {
      openingSave = false;
      toast('无法连接账号棋谱本，请稍后重试。');
      return;
    }
    openingSave = false;
    const existing = records.find(record => record.id === pendingSave.id);
    el('record-name').value = existing?.title ?? (pendingSave.mode === 'local' ? '同屏对局' : `与电脑对弈 · 执${pendingSave.color === 'w' ? '白' : '黑'}`);
    el('save-info').textContent = metadata(pendingSave) + (existing ? ' · 更新本局记录' : '');
    saveDialog.showModal();
    el('record-name').select();
  });
  el('record-name').addEventListener('input', event => event.target.setCustomValidity(''));
  el('save-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (!pendingSave) return;
    const field = el('record-name');
    const title = field.value.trim();
    if (!title) {
      field.setCustomValidity('给棋谱起一个名字。');
      field.reportValidity();
      return;
    }
    const current = records;
    const existing = current.find(record => record.id === pendingSave.id);
    const entry = { ...pendingSave, title, savedAt: Date.now() };
    if (existing && lineKey(existing) === lineKey(entry)) entry.report = existing.report;
    try {
      el('save-form').querySelector('[type=submit]').disabled = true;
      await store.save(entry);
    } catch (error) {
      el('save-info').textContent = error.volatile
        ? '尚未同步，数据仅保留在当前页面；请勿刷新，检查网络后重试。'
        : '尚未同步到账号，请检查网络后重试；若另一设备已修改，请刷新后再保存。';
      return;
    } finally {
      el('save-form').querySelector('[type=submit]').disabled = false;
    }
    errors.delete(entry.id);
    saveDialog.close();
    pendingSave = null;
    await refresh(entry.id);
    toast('已保存到棋谱本。');
  });
  saveDialog.addEventListener('close', () => { pendingSave = null; });
  el('record-copy').addEventListener('click', () => {
    if (selected) void copyPgn(study.line.game, { ...selected, result: selected.result.pgn }, toast);
  });
  el('record-download').addEventListener('click', () => {
    if (selected) downloadPgn(study.line.game, { ...selected, result: selected.result.pgn }, toast);
  });
  el('record-analyze').addEventListener('click', analyze);
  el('report-cancel').addEventListener('click', () => {
    const job = selected && jobs.get(selected.id);
    if (!job) return;
    job.worker.terminate();
    jobs.delete(selected.id);
    errors.set(selected.id, '已停止分析。');
    showReport();
  });
  // Start the one-time local import on site entry, even before opening the notebook.
  void refresh();
  return { refresh, isSaved: (id, moves) => records.some(record => record.id === id && lineKey(record) === moves.join(' ')) };
}
