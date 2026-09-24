// Bundles fake-indexeddb (Apache-2.0) into runtime/idb.js for apps that use IndexedDB.
// Browsers block IndexedDB in Jhino's sandboxed app frames; the runtime shim saves this one to the server instead.
// Run after upgrading fake-indexeddb: npm run build:idb
import { build } from 'esbuild';
import fs from 'node:fs';
const version = JSON.parse(fs.readFileSync('node_modules/fake-indexeddb/package.json', 'utf8')).version;
await build({
  stdin: { contents: "import * as F from 'fake-indexeddb'; window.__JHINO_FAKE_IDB__ = F;", resolveDir: process.cwd() },
  bundle: true, format: 'iife', minify: true, target: 'es2020', outfile: 'runtime/idb.js',
  banner: { js: `/* fake-indexeddb ${version}, Apache-2.0, https://github.com/dumbmatter/fakeIndexedDB. Bundled for Jhino by scripts/build-idb.mjs. */` },
});
console.log('runtime/idb.js written');
