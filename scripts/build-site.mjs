import { copyFile, mkdir, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const output = new URL('dist/', root);
await mkdir(output, { recursive: true });

const files = ['index.html', 'estilo.css', 'app.js', 'modelo.js', 'nuvem.js', 'manifest.webmanifest', 'sw.js'];
await Promise.all(files.map(file => copyFile(new URL(file, root), new URL(file, output))));
await writeFile(new URL('_headers', output), `/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: no-referrer
/sw.js
  Cache-Control: no-cache
`);
