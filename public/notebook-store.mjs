const localKey = 'walnut-chess.notebook.v1';
const markerPrefix = 'walnut-chess.notebook.imported.v1.';
const pendingPrefix = 'walnut-chess.notebook.pending.v1.';
function readLegacy() {
  try {
    const raw = localStorage.getItem(localKey);
    if (raw === null) return { entries: [], partial: false };
    const values = JSON.parse(raw);
    if (!Array.isArray(values)) return { entries: [], partial: true };
    const entries = values.filter(entry => (
      typeof entry?.id === 'string' && typeof entry.title === 'string' && Number.isFinite(entry.savedAt)
      && Array.isArray(entry.moves) && entry.moves.length > 0 && entry.result
    ));
    return { entries, partial: entries.length !== values.length };
  } catch { return { entries: [], partial: true }; }
}
export function localRecords() { return readLegacy().entries; }
async function request(path, data) {
  const response = await fetch(path, data === undefined ? { cache: 'no-store', credentials: 'same-origin' } : {
    method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = new Error(response.status === 409 ? 'conflict' : response.status === 401 ? 'sign_in' : 'network');
    error.status = response.status;
    throw error;
  }
  return response.json();
}
function read(key, fallback) { try { return JSON.parse(localStorage.getItem(key) ?? JSON.stringify(fallback)); } catch { return fallback; } }
function write(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } }
function clearPending(key, id, operation) {
  const current = read(key, {}) || {};
  if (JSON.stringify(current[id]) === JSON.stringify(operation)) {
    delete current[id];
    write(key, current);
  }
}
export function createNotebookStore() {
  let account = null;
  let revisions = new Map();
  let entries = [];
  const sessionPending = new Map();
  function clearSession(owner, id, operation) {
    const pending = sessionPending.get(owner);
    if (pending && JSON.stringify(pending[id]) === JSON.stringify(operation)) delete pending[id];
  }
  async function load() {
    let result = await request('/api/notebook');
    account = result.account;
    const expectedAccount = account;
    const marker = markerPrefix + expectedAccount;
    let partialImport = false;
    if (!read(marker, false)) {
      const legacy = readLegacy();
      const old = legacy.entries;
      partialImport = legacy.partial;
      // Each batch is idempotent; the marker is written only after all imports succeed.
      for (const record of old) {
        try { await request('/api/notebook/import', { account: expectedAccount, entries: [record] }); }
        catch (error) {
          if (error.status === 400 || error.status === 413) partialImport = true;
          else throw error;
        }
      }
      if (!partialImport) write(marker, true);
      if (old.length) result = await request('/api/notebook');
      if (result.account !== expectedAccount) throw new Error('account_changed');
    }
    const pendingKey = pendingPrefix + expectedAccount;
    const pending = { ...(read(pendingKey, {}) || {}), ...(sessionPending.get(expectedAccount) || {}) };
    let changed = false;
    for (const [id, operation] of Object.entries(pending)) {
      const cloud = result.entries.find(item => item.record.id === id);
      if (cloud && JSON.stringify(cloud.record) === JSON.stringify(operation.record)) {
        clearPending(pendingKey, id, operation); clearSession(expectedAccount, id, operation); changed = true; continue;
      }
      if ((cloud?.revision ?? null) !== operation.revision) continue;
      try {
        await request('/api/notebook/save', { ...operation, account: expectedAccount });
        clearPending(pendingKey, id, operation); clearSession(expectedAccount, id, operation); changed = true;
      } catch { /* Preserve the local copy for a later retry. */ }
    }
    if (changed) {
      result = await request('/api/notebook');
      if (result.account !== expectedAccount) throw new Error('account_changed');
    }
    if (account !== expectedAccount) throw new Error('account_changed');
    entries = result.entries.map(item => item.record);
    revisions = new Map(result.entries.map(item => [item.record.id, item.revision]));
    const volatile = Object.keys(sessionPending.get(expectedAccount) || {}).length > 0;
    return { entries, partialImport, pending: volatile || Object.keys(read(pendingKey, {}) || {}).length > 0, volatile };
  }
  async function save(record) {
    if (!account) throw new Error('not_loaded');
    const expectedAccount = account;
    const revision = revisions.get(record.id) ?? null;
    const key = pendingPrefix + expectedAccount;
    const pending = read(key, {});
    const operation = { record, revision };
    pending[record.id] = operation;
    const persisted = write(key, pending);
    const session = sessionPending.get(expectedAccount) || {};
    session[record.id] = operation;
    sessionPending.set(expectedAccount, session);
    if (persisted) clearSession(expectedAccount, record.id, operation);
    let result;
    try { result = await request('/api/notebook/save', { ...operation, account: expectedAccount }); }
    catch (error) { error.volatile = !persisted; throw error; }
    clearPending(key, record.id, operation);
    clearSession(expectedAccount, record.id, operation);
    if (account !== expectedAccount) throw new Error('account_changed');
    revisions.set(record.id, result.revision);
    entries = [record, ...entries.filter(item => item.id !== record.id)];
  }
  return { load, save };
}
