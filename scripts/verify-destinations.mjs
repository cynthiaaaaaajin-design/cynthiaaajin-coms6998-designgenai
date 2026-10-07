import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
function load(path, dependencies = {}) {
  const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const loaded = { exports: {} };
  vm.runInNewContext(code, { module: loaded, exports: loaded.exports, require: name => { assert.ok(name in dependencies, name); return dependencies[name]; } });
  return loaded.exports;
}
const destinations = load('lib/destinations.ts');
const scenes = load('components/trip-covers/scenes.tsx', { 'react/jsx-runtime': jsx });
const { TripCoverArt } = load('components/trip-cover-art.tsx', { 'react/jsx-runtime': jsx, '@/lib/destinations': destinations, '@/components/trip-covers/scenes': scenes });
const cases = [
  ['Lisbon', 'Lisbon, Portugal', 'europe-city'],
  ['lisbon portugal', 'Lisbon, Portugal', 'europe-city'],
  ['东京', 'Tokyo, Japan', 'asia-city'],
  ['Tokyo, Japan', 'Tokyo, Japan', 'asia-city'],
  ['Miami', 'Miami, Florida, USA', 'beach'],
  ['Puerto Rico', 'Puerto Rico', 'island'],
  ['Bali', 'Bali, Indonesia', 'tropical'],
  ['Seoul', 'Seoul, South Korea', 'asia-city'],
  ['Unknown custom destination', 'Unknown Custom Destination', 'generic'],
  ['  MIAMI,   FL  ', 'Miami, Florida, USA', 'beach'],
  ['pr', 'Puerto Rico', 'island'],
  ['The Dolomites, Italy', 'Dolomites, Italy', 'mountain'],
  ['Tokyo, Texas', 'Tokyo, Texas', 'generic'],
  ['   ', 'Somewhere Wonderful', 'generic'],
];
for (const [input, canonical, theme] of cases) {
  const result = destinations.normalizeDestination(input);
  assert.equal(result.raw, input);
  assert.equal(result.canonical, canonical);
  assert.equal(result.theme, theme);
  assert.equal(destinations.normalizeDestination(canonical).canonical, canonical);
  assert.ok(result.slug.length);
  const markup = renderToStaticMarkup(createElement(TripCoverArt, { destination: input }));
  assert.ok(markup.includes(`data-theme="${theme}"`));
  assert.ok(markup.includes('role="img"'));
  assert.ok(markup.includes(canonical));
  assert.ok(markup.includes('<path'));
  assert.ok(!markup.includes('href=') && !markup.includes('<image'));
  console.log(`PASS: ${JSON.stringify(input)} → ${canonical} / ${theme} / local SVG rendered`);
}
assert.equal(destinations.normalizeDestination('Kyoto').city, 'Kyoto');
assert.equal(destinations.normalizeDestination('miami').region, 'Florida');
assert.equal(destinations.normalizeDestination('东京').slug, 'tokyo-japan');
const unsafe = renderToStaticMarkup(createElement(TripCoverArt, { destination: '<script>alert(1)</script>' }));
assert.ok(!unsafe.includes('<script>'));
const sceneMarkup = new Set(['beach','island','europe-city','asia-city','mountain','tropical','generic'].map(theme => renderToStaticMarkup(createElement(scenes.CoverScene, { theme }))));
assert.equal(sceneMarkup.size, 7, 'Every shipped theme has a distinct illustration');
