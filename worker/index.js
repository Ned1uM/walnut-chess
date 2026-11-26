const jsonHeaders = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' };
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: jsonHeaders });
function valid(record) {
  return record && typeof record === 'object' && typeof record.id === 'string' && record.id.length > 0 && record.id.length <= 128 &&
    typeof record.title === 'string' && record.title.trim().length > 0 && record.title.length <= 300 && Number.isFinite(record.savedAt) &&
    Array.isArray(record.moves) && record.moves.length > 0 && record.moves.length <= 2000 && record.moves.every(m => typeof m === 'string' && m.length <= 32) &&
    record.result && typeof record.result === 'object' && JSON.stringify(record).length <= 500000;
}
async function accountKey(id) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
async function api(request, env, path) {
  const owner = request.headers.get('oai-authenticated-user-id');
  if (!owner) return reply({ error: 'sign_in_required' }, 401);
  if (!env.DB) return reply({ error: 'storage_unavailable' }, 503);
  try {
    if (path === '/api/notebook' && request.method === 'GET') {
      const result = await env.DB.prepare('SELECT record, revision FROM notebook_entries WHERE owner_id = ?').bind(owner).all();
      return reply({ account: await accountKey(owner), entries: result.results.map(row => ({ record: JSON.parse(row.record), revision: row.revision })) });
    }
    if (request.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405);
    const origin = request.headers.get('origin');
    if ((origin && origin !== new URL(request.url).origin) || !request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return reply({ error: 'invalid_request' }, 403);
    const length = Number(request.headers.get('content-length') || 0);
    if (length > 5000000) return reply({ error: 'too_large' }, 413);
    const body = await request.json();
    if (body.account !== await accountKey(owner)) return reply({ error: 'account_changed' }, 409);
    if (path === '/api/notebook/import') {
      if (!Array.isArray(body.entries) || body.entries.length > 500 || !body.entries.every(valid)) return reply({ error: 'invalid_entries' }, 400);
      if (body.entries.length) await env.DB.batch(body.entries.map(record => env.DB.prepare('INSERT OR IGNORE INTO notebook_entries (owner_id, entry_id, record, revision) VALUES (?, ?, ?, 1)').bind(owner, record.id, JSON.stringify(record))));
      return reply({ ok: true });
    }
    if (path === '/api/notebook/save') {
      const { record, revision } = body;
      if (!valid(record) || !(revision === null || (Number.isSafeInteger(revision) && revision > 0))) return reply({ error: 'invalid_entry' }, 400);
      const stmt = revision === null
        ? env.DB.prepare('INSERT OR IGNORE INTO notebook_entries (owner_id, entry_id, record, revision) VALUES (?, ?, ?, 1)').bind(owner, record.id, JSON.stringify(record))
        : env.DB.prepare('UPDATE notebook_entries SET record = ?, revision = revision + 1 WHERE owner_id = ? AND entry_id = ? AND revision = ?').bind(JSON.stringify(record), owner, record.id, revision);
      const result = await stmt.run();
      if (!result.meta?.changes) return reply({ error: 'conflict' }, 409);
      return reply({ revision: revision === null ? 1 : revision + 1 });
    }
    return reply({ error: 'not_found' }, 404);
  } catch (error) {
    console.error('Notebook request failed', error instanceof Error ? error.message : 'unknown');
    return reply({ error: 'storage_unavailable' }, 503);
  }
}
export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === '/api/notebook' || path.startsWith('/api/notebook/')) return api(request, env, path);
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
    const asset = ASSETS[path === '/' ? '/index.html' : path];
    if (!asset) return new Response('Not found', { status: 404 });
    const bytes = Uint8Array.from(atob(asset.data), c => c.charCodeAt(0));
    return new Response(request.method === 'HEAD' ? null : bytes, { headers: { 'content-type': asset.type, 'x-content-type-options': 'nosniff' } });
  },
};
