import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(path, deps = {}, globals = {}) {
  const loaded = { exports: {} };
  const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { module: loaded, exports: loaded.exports, Buffer, Request, Response, Date, process: { env: { GEMINI_API_KEY: 'fixture' } }, require: id => { assert.ok(id in deps, id); return deps[id]; }, ...globals });
  return loaded.exports;
}
const expenses = load('lib/expenses.ts');
const receipts = load('lib/expense-receipt.ts', { './expenses': expenses });
const draft = { description: 'Shared dinner', amount: '60.00', currency: 'USD', expense_date: '2026-11-14', category: 'Food & Drinks', warnings: [] };
assert.equal(receipts.parseReceiptDraft(JSON.stringify(draft)).amount, '60.00');
for (const amount of ['NaN', '-12', '0', '1.001', '100000000000']) assert.equal(receipts.parseReceiptDraft(JSON.stringify({ ...draft, amount })).amount, null);
assert.equal(receipts.parseReceiptDraft(JSON.stringify({ ...draft, currency: 'JPY', amount: '50.01' })).amount, null);
assert.equal(receipts.parseReceiptDraft(JSON.stringify({ ...draft, currency: 'KWD', amount: '5.123' })).amount, '5.123');
for (const expense_date of ['2026-02-30', '2026-13-01', '14/11/2026', 'x']) assert.equal(receipts.parseReceiptDraft(JSON.stringify({ ...draft, expense_date })).expense_date, null);
for (const currency of ['__proto__', 'constructor', 'XXX']) assert.throws(() => receipts.parseReceiptDraft(JSON.stringify({ ...draft, currency })));
const unknown = receipts.parseReceiptDraft(JSON.stringify({ ...draft, amount: null, currency: null, expense_date: null }));
assert.equal(unknown.currency, null); assert.ok(unknown.warnings.length >= 3);
assert.throws(() => receipts.parseReceiptDraft(JSON.stringify({ ...draft, warnings: Array(11).fill('x') })));
const image = { mimeType: 'image/png', data: Buffer.from([137,80,78,71,13,10,26,10,1,2,3]).toString('base64') };
assert.equal(receipts.receiptImage(image).data, image.data);
for (const value of [{ ...image, mimeType: 'text/html' }, { ...image, data: 'not base64' }, { ...image, data: Buffer.from('<script/>').toString('base64') }, { ...image, data: Buffer.alloc(receipts.receiptMaxBytes + 1).toString('base64') }]) assert.throws(() => receipts.receiptImage(value));
await assert.rejects(() => receipts.receiptRequestBody(new Request('https://trip.test', { method: 'POST', headers: { 'content-length': '4000000' }, body: '{}' })));
await assert.rejects(() => receipts.receiptRequestBody(new Request('https://trip.test', { method: 'POST', body: 'x'.repeat(3000000) })));
let accessResponse = null, modelCalls = 0, modelInput;
let modelResponse = { candidates: [{ finishReason: 'STOP' }], text: JSON.stringify(draft) };
const route = load('app/api/trips/[tripId]/expenses/receipt/route.ts', {
  '@google/genai': { GoogleGenAI: class { models = { generateContent: async input => { modelCalls++; modelInput = input; return modelResponse; } }; } },
  '@/lib/collaboration-route': { collaborationAccess: async () => accessResponse || { user: { id: 'cynthia' } }, collaborationJson: (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'private, no-store' } }) },
  '@/lib/expense-receipt': receipts,
});
async function post(body = image) { return route.POST(new Request('https://trip.test/api/trips/1/expenses/receipt', { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ tripId: '1' }) }); }
for (const status of [401, 403, 404]) { accessResponse = new Response(null, { status }); assert.equal((await post()).status, status); }
assert.equal(modelCalls, 0); accessResponse = null;
assert.equal((await post({ ...image, mimeType: 'text/plain' })).status, 400); assert.equal(modelCalls, 0);
const result = await post(); assert.equal(result.status, 200); assert.match(result.headers.get('cache-control'), /no-store/); assert.equal((await result.json()).draft.amount, '60.00');
assert.equal(modelInput.contents[0].parts[1].inlineData.data, image.data);
assert.equal('client' in modelInput, false);
modelResponse = { candidates: [{ finishReason: 'MAX_TOKENS' }], text: JSON.stringify(draft) }; assert.equal((await post()).status, 502);
modelResponse = { candidates: [{ finishReason: 'STOP' }], text: '{invalid' }; assert.equal((await post()).status, 502);
// Two independently submitted expenses must net to an exact, single transfer.
const entries = [{ currency: 'USD', amount: 6000, payer_id: 'cynthia', allocations: expenses.allocate(6000, 'equal', [{ user_id: 'cynthia' }, { user_id: 'yj' }], 'USD') }, { currency: 'USD', amount: 2000, payer_id: 'yj', allocations: expenses.allocate(2000, 'equal', [{ user_id: 'cynthia' }, { user_id: 'yj' }], 'USD') }];
const transfers = expenses.settlement(entries).transfers;
assert.equal(transfers.length, 1); assert.equal(transfers[0].from, 'yj'); assert.equal(transfers[0].to, 'cynthia'); assert.equal(transfers[0].amount, 2000);
console.log('PASS receipt parsing, unknown/invalid fields, MIME/signature/size bounds, bounded streamed body, auth-gated read-only extraction, incomplete AI response, and exact two-payer settlement. Provider/auth calls are fixtures.');

// Exercise the file-selection event without a browser: it must request OCR automatically,
// but may not write an expense merely because a receipt was selected.
let recognitionRequests = 0, expenseWrites = 0;
const jsx = (type, props) => ({ type, props });
const component = load('components/expense-editor.tsx', {
  react: { useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}], useRef: current => ({ current }), useEffect: () => {} },
  'react/jsx-runtime': { jsx, jsxs: jsx },
  '@/lib/expenses': expenses,
  '@/lib/expense-receipt': receipts,
}, {
  crypto, AbortController,
  URL: { createObjectURL: () => 'blob:fixture', revokeObjectURL: () => {} },
  FileReader: class { readAsDataURL() { this.result = 'data:image/png;base64,' + image.data; queueMicrotask(() => this.onload()); } },
  fetch: async () => { recognitionRequests++; return { ok: true, json: async () => ({ draft }) }; },
});
const tree = component.ExpenseEditor({ tripId: '1', userId: 'cynthia', people: [{ user_id: 'cynthia', name: 'Cynthia' }], busy: false, onSave: async () => { expenseWrites++; return true; }, onCancel: () => {} });
function findFile(node) {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'input' && node.props.type === 'file') return node;
  for (const child of [node.props?.children].flat(Infinity)) { const found = findFile(child); if (found) return found; }
  return null;
}
const fileControl = findFile(tree); assert.ok(fileControl);
fileControl.props.onChange({ target: { files: [{ type: 'image/png', size: 100 }] } });
await new Promise(resolve => setImmediate(resolve));
assert.equal(recognitionRequests, 1); assert.equal(expenseWrites, 0);
console.log('PASS selecting an image automatically requests recognition without saving an expense. Component hooks/provider are fixtures.');
