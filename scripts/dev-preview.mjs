// Local preview only. Production identity is supplied by Sites dispatch.
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import worker from '../dist/server/index.js';
const db = new DatabaseSync(':memory:');
db.exec(await readFile('drizzle/0000_notebook.sql', 'utf8'));
class Statement {
  constructor(query, params = []) { this.query = query; this.params = params; }
  bind(...params) { return new Statement(this.query, params); }
  async all() { return { results: db.prepare(this.query).all(...this.params) }; }
  async run() { return { meta: { changes: Number(db.prepare(this.query).run(...this.params).changes) } }; }
}
const DB = { prepare: q => new Statement(q), async batch(statements) { db.exec('BEGIN'); try { for (const s of statements) await s.run(); db.exec('COMMIT'); } catch(e) { db.exec('ROLLBACK'); throw e; } } };
const portIndex = process.argv.indexOf('--port');
const port = portIndex < 0 ? 4173 : Number(process.argv[portIndex + 1]);
http.createServer(async (req, res) => {
  try {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const headers = new Headers(req.headers); headers.set('oai-authenticated-user-id', 'local-preview-user');
    const options = { method: req.method, headers };
    if (chunks.length) options.body = Buffer.concat(chunks);
    const response = await worker.fetch(new Request(`http://${req.headers.host}${req.url}`, options), {DB});
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch { res.writeHead(500); res.end('Preview error'); }
}).listen(port, '0.0.0.0', () => console.log(`Preview listening on ${port}`));
