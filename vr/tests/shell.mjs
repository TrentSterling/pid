import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const shell = readFileSync(join(root, 'shell.js'), 'utf8');
const routes = [...shell.matchAll(/\{ path: '([^']*)', label: '([^']+)'/g)].map((m) => m[1]);

test('the shell lists five sections and each one is a real page', () => {
  assert.equal(routes.length, 5);
  for (const path of routes) assert.ok(existsSync(join(root, path, 'index.html')), `missing page for route "${path}"`);
});

test('every section page loads the shell before its own modules', () => {
  for (const path of routes) {
    const html = readFileSync(join(root, path, 'index.html'), 'utf8');
    const expected = `${relative(join(root, path), root) || '.'}/shell.js`.replace(/\\/g, '/');
    const at = html.indexOf(`<script src="${expected}"></script>`);
    assert.ok(at > 0, `${path || '/'} does not load ${expected}`);
    const firstModule = html.indexOf('<script type="module"');
    if (firstModule >= 0) assert.ok(at < firstModule, `${path || '/'} loads the shell after a module`);
    assert.ok(html.includes('class="masthead"'), `${path || '/'} lost its own header, which is the fallback when the shell cannot run`);
  }
});
