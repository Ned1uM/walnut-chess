import { readdir, readFile, mkdir, rm, writeFile, cp } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
const root = process.cwd();
const types = { '.html':'text/html; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.png':'image/png', '.woff2':'font/woff2', '.txt':'text/plain; charset=utf-8' };
const assets = {};
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (entry.isFile()) assets['/' + relative(join(root, 'public'), path).replaceAll('\\', '/')] = { type: types[extname(path)] ?? 'application/octet-stream', data: (await readFile(path)).toString('base64') };
  }
}
await walk(join(root, 'public'));
const code = await readFile(join(root, 'worker/index.js'), 'utf8');
await rm('dist', { recursive:true, force:true });
await mkdir('dist/server', { recursive:true });
await mkdir('dist/.openai', { recursive:true });
await writeFile('dist/server/index.js', `const ASSETS = ${JSON.stringify(assets)};\n${code}`);
await cp('.openai/hosting.json', 'dist/.openai/hosting.json');
await cp('drizzle', 'dist/.openai/drizzle', { recursive:true });
console.log(`Built Worker with ${Object.keys(assets).length} assets`);
