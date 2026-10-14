// Mocked Supabase and Gemini only: no live API calls or database writes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(path, dependencies = {}, globals = {}) {
  const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const loaded = { exports: {} };
  vm.runInNewContext(source, {
    exports: loaded.exports, module: loaded, Response, Request, URL, console, ...globals,
    require: name => {
      if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name}`);
      return dependencies[name];
    },
  });
  return loaded.exports;
}
const feedback = load('../lib/feedback.ts');
const itinerary = load('../lib/itinerary.ts');
const revision = load('../lib/revision.ts', { './feedback': feedback });
const originalPrompt = itinerary.buildPrompt({ title: 'Paris', destination: 'Paris', start_date: '2026-10-10', end_date: '2026-10-10' }, { budget: 'EUR 100 per day', interests: 'Art', avoid: 'Long hikes', instructions: 'Relaxed pace' }, 1);
const activity = { day_number: 1, position: 0, start_time: '09:00', title: 'Museum', description: 'Explore art', location: 'Paris' };
const items = [{ id: 'old-item', ...activity }];
const rows = [
  { id: '9007199254740992', item_id: 'old-item', user_id: 'owner', value: 1, comment: 'OBSOLETE_COMMENT' },
  { id: '9007199254740993', item_id: 'old-item', user_id: 'owner', value: -1, comment: 'Prefer outdoors' },
  { id: '9007199254740994', item_id: 'old-item', user_id: 'member', value: 1, comment: 'Keep art' },
];
const trip = { destination: 'Paris', start_date: '2026-10-10', end_date: '2026-10-10' };
const prompt = revision.buildRevisionPrompt(trip, originalPrompt, 1, items, rows, 1);
const context = JSON.parse(prompt.split('Revision context:\n')[1]);
assert.equal(context.original_generation_prompt, originalPrompt);
assert.equal(context.previous_itinerary[0].feedback.likes, 1);
assert.equal(context.previous_itinerary[0].feedback.dislikes, 1);
assert.equal(context.previous_itinerary[0].feedback.comments.length, 2);
assert.ok(!prompt.includes('OBSOLETE_COMMENT'));
assert.ok(prompt.includes('Prefer outdoors'));
assert.ok(prompt.includes('Keep art'));
assert.ok(prompt.includes('EUR 100 per day'));
assert.ok(!prompt.includes('9007199254740993'));
assert.ok(!prompt.includes('"user_id"'));

// The old immediate publisher is intentionally retired. Both routes share the same handlers,
// whose ownership, base-version and snapshot behavior is exercised in verify-phase3.mjs.
const handlers = { POST: async () => Response.json({proposalId:'preview'}), PATCH: async () => Response.json({versionId:'published'}) };
const compatibility = load('../app/api/trips/[tripId]/revise/route.ts', { '../proposals/route': handlers });
assert.equal(compatibility.POST, handlers.POST);
assert.equal(compatibility.PATCH, handlers.PATCH);
assert.deepEqual(await (await compatibility.POST()).json(), {proposalId:'preview'});
console.log('PASS: historical revision prompt interpretation and legacy revision route delegates to unified preview/apply handlers; no immediate-publication bypass.');
