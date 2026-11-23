// The service worker must store every file the app loads, or the app won't open with no signal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const shell = JSON.parse(sw.match(/const SHELL = (\[[\s\S]*?\]);/)[1].replace(/'/g, '"').replace(/,\s*\]/, ']'));
const files = dir => readdirSync(new URL(`../${dir}/`, import.meta.url), { withFileTypes: true })
  .flatMap(d => d.isDirectory() ? files(`${dir}/${d.name}`) : [`${dir}/${d.name}`]);

test('every app script is stored for offline use', () => {
  for (const f of files('src')) assert.ok(shell.includes(f), `sw.js SHELL is missing ${f}`);
});

test('every vendored library, font and image is stored for offline use', () => {
  for (const f of files('vendor').filter(f => !/LICENSE$/.test(f))) assert.ok(shell.includes(f), `sw.js SHELL is missing ${f}`);
});

test('the page, styles, manifest and icon are stored, and every stored file exists', () => {
  for (const f of ['./', 'index.html', 'styles.css', 'manifest.webmanifest', 'icon.svg']) assert.ok(shell.includes(f), f);
  for (const f of shell.filter(f => f !== './')) assert.doesNotThrow(() => readFileSync(new URL(`../${f}`, import.meta.url)), f);
});

test('the page loads its text font from the app itself, with Verdana as the fallback', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  assert.ok(!/fonts\.googleapis|fonts\.gstatic/.test(html + css), 'no font from the internet');
  assert.match(css, /--font: "Atkinson Hyperlegible", Verdana/);
});
