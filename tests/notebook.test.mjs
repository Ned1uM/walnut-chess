import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import worker from '../dist/server/index.js';
import { createNotebookStore } from '../public/notebook-store.mjs';
const sql = new DatabaseSync(':memory:');
sql.exec(await readFile('drizzle/0000_notebook.sql', 'utf8'));
class Statement {
  constructor(query, params = []) { this.query = query; this.params = params; }
  bind(...params) { return new Statement(this.query, params); }
  async all() { return { results: sql.prepare(this.query).all(...this.params) }; }
  async run() { return { meta: { changes: Number(sql.prepare(this.query).run(...this.params).changes) } }; }
}
const DB = { prepare: q => new Statement(q), async batch(stmts) { sql.exec('BEGIN'); try { const out = []; for (const s of stmts) out.push(await s.run()); sql.exec('COMMIT'); return out; } catch (e) { sql.exec('ROLLBACK'); throw e; } } };
let user = 'account-a';
let failNext = false;
let calls = 0;
function storage() { const map = new Map(); return { getItem: k => map.get(k) ?? null, setItem: (k,v) => map.set(k, String(v)), map }; }
const contextA = storage(), contextB = storage(), contextOther = storage();
globalThis.localStorage = contextA;
globalThis.fetch = async (path, options = {}) => {
  calls++;
  if (failNext) { failNext = false; throw new Error('offline'); }
  const headers = new Headers(options.headers);
  if (user) headers.set('oai-authenticated-user-id', user);
  return worker.fetch(new Request('https://chess.test' + path, { ...options, headers }), { DB });
};
const record = { id:'game-1', title:'本地棋谱', savedAt:1, mode:'local', color:'w', level:'normal', moves:['e4','e5'], result:{pgn:'*',title:''} };
contextA.setItem('walnut-chess.notebook.v1', JSON.stringify([record]));
const a = createNotebookStore();
assert.deepEqual((await a.load()).entries, [record], 'first access imports local data');
assert.equal(sql.prepare('SELECT count(*) AS n FROM notebook_entries').get().n, 1);
await a.load();
assert.equal(sql.prepare('SELECT count(*) AS n FROM notebook_entries').get().n, 1, 'repeated loads do not duplicate');
const updated = { ...record, title:'更新棋谱', savedAt:2 };
await a.save(updated);
globalThis.localStorage = contextB;
contextB.setItem('walnut-chess.notebook.v1', JSON.stringify([{...record,title:'旧副本'}]));
const b = createNotebookStore();
assert.deepEqual((await b.load()).entries, [updated], 'independent browser sees account and cloud wins local conflict');
const analyzed = { ...updated, report:{version:1,scanned:2,moments:[],scores:[]} };
await b.save(analyzed);
globalThis.localStorage = contextA;
assert.deepEqual((await a.load()).entries, [analyzed], 'analysis propagates back');
user = 'account-b'; globalThis.localStorage = contextOther;
const other = createNotebookStore();
assert.deepEqual((await other.load()).entries, [], 'different account isolated');
user = null;
assert.equal((await worker.fetch(new Request('https://chess.test/api/notebook'), {DB})).status, 401);
user = 'account-a'; globalThis.localStorage = contextA;
await a.load();
const pending = {...analyzed,title:'断网后保存',savedAt:3};
failNext = true;
await assert.rejects(a.save(pending));
assert.deepEqual((await a.load()).entries, [pending], 'failed write retained and retried');
const stale = createNotebookStore(); await stale.load();
await a.load(); await a.save({...pending,title:'最新版本'});
await assert.rejects(stale.save({...pending,title:'过期版本'}), /conflict/);
const reloaded = await stale.load();
assert.equal(reloaded.entries[0].title, '最新版本');
assert.equal(reloaded.pending, true, 'conflicting offline edit retained locally');
// When browser storage is blocked, a failed request must still be retryable in this session.
user = 'account-d';
globalThis.localStorage = { getItem: () => null, setItem: () => { throw new Error('storage blocked'); } };
const volatileStore = createNotebookStore(); await volatileStore.load();
const volatileRecord = {...record, id:'volatile', title:'本次会话待同步'};
failNext = true;
await assert.rejects(volatileStore.save(volatileRecord), error => error.volatile === true);
user = 'account-e';
assert.deepEqual((await volatileStore.load()).entries, [], 'session pending entry never crosses accounts');
assert.equal(sql.prepare('SELECT count(*) AS n FROM notebook_entries WHERE owner_id = ? AND entry_id = ?').get('account-e', 'volatile').n, 0);
user = 'account-d';
assert.deepEqual((await volatileStore.load()).entries, [volatileRecord], 'session copy is retried when storage is unavailable');
assert.equal(sql.prepare('SELECT count(*) AS n FROM notebook_entries WHERE owner_id = ? AND entry_id = ?').get('account-d', 'volatile').n, 1, 'retry reaches the original account');
// A newer durable operation supersedes an older session-only operation.
user = 'account-f'; const recovering = storage(); let blocked = true;
globalThis.localStorage = { getItem: k => recovering.getItem(k), setItem: (k,v) => { if (blocked) throw new Error('blocked'); recovering.setItem(k,v); } };
const recoveringStore = createNotebookStore(); await recoveringStore.load();
failNext = true; await assert.rejects(recoveringStore.save({...record,id:'recovery',title:'旧'}));
blocked = false; failNext = true; await assert.rejects(recoveringStore.save({...record,id:'recovery',title:'新'}));
assert.equal((await recoveringStore.load()).entries[0].title, '新', 'new durable edit replaces older session edit');
// An older in-flight write cannot clear a newer session operation.
user = 'account-g'; globalThis.localStorage = { getItem: () => null, setItem: () => { throw new Error('blocked'); } };
const overlapping = createNotebookStore(); await overlapping.load();
const normalFetch = globalThis.fetch; let release;
globalThis.fetch = (path, options) => path === '/api/notebook/save' && !release
  ? new Promise(resolve => { release = () => resolve(normalFetch(path, options)); }) : normalFetch(path, options);
const first = overlapping.save({...record,id:'overlap',title:'旧'});
failNext = true; await assert.rejects(overlapping.save({...record,id:'overlap',title:'新'}));
release(); await first; globalThis.fetch = normalFetch;
assert.equal((await overlapping.load()).volatile, true, 'older completion preserves newer conflicting session edit');
// Authentication can change after the list was loaded but before a write arrives.
globalThis.localStorage = storage(); user = 'account-a';
const switchStore = createNotebookStore(); await switchStore.load();
user = 'account-b';
await assert.rejects(switchStore.save({...record, id:'must-not-cross', title:'wrong account'}), /conflict/);
assert.equal(sql.prepare('SELECT count(*) AS n FROM notebook_entries WHERE owner_id = ? AND entry_id = ?').get('account-b', 'must-not-cross').n, 0, 'account switch cannot write into another account');
// One invalid old entry must not prevent valid siblings from importing.
user = 'account-c'; const partialContext = storage(); globalThis.localStorage = partialContext;
partialContext.setItem('walnut-chess.notebook.v1', JSON.stringify([{...record, id:'oversized', report:'x'.repeat(500001)}, {...record, id:'valid-after-bad'}]));
const partial = createNotebookStore();
const partialResult = await partial.load();
assert.equal(partialResult.partialImport, true);
assert.deepEqual(partialResult.entries.map(e => e.id), ['valid-after-bad']);
assert.ok(partialContext.getItem('walnut-chess.notebook.v1').includes('oversized'), 'legacy source remains untouched');
const missing = await worker.fetch(new Request('https://chess.test/not-found'), {DB}); assert.equal(missing.status, 404);
for (const path of ['/', '/app.mjs', '/pieces/wk.png', '/vendor/three.module.min.js', '/noto-serif-sc-112-600-normal.woff2']) {
  const response = await worker.fetch(new Request('https://chess.test'+path), {DB});
  assert.equal(response.status, 200, path);
  assert.ok((await response.arrayBuffer()).byteLength > 0, path);
}
console.log('Notebook API, SQLite migration, account isolation, migration, conflict and retry checks passed.');
