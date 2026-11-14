import { currencies, minor, type Currency } from './expenses';

// Keep the encoded JSON request below common serverless request limits.
export const receiptMaxBytes = 2 * 1024 * 1024;
export const expenseCategories = ['Food & Drinks', 'Transportation', 'Accommodation', 'Activities', 'Shopping', 'Other'] as const;
export type ReceiptDraft = {
  description: string;
  amount: string | null;
  currency: Currency | null;
  expense_date: string | null;
  category: typeof expenseCategories[number];
  warnings: string[];
};

export const receiptSchema = {
  type: 'object',
  properties: {
    description: { type: 'string' },
    amount: { type: ['string', 'null'], description: 'Final paid total as a decimal string, no currency symbols or separators; null if unclear.' },
    currency: { type: ['string', 'null'], enum: [...Object.keys(currencies), null] },
    expense_date: { type: ['string', 'null'], description: 'YYYY-MM-DD, only if unambiguous on the receipt.' },
    category: { type: 'string', enum: [...expenseCategories] },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['description', 'amount', 'currency', 'expense_date', 'category', 'warnings'],
  additionalProperties: false,
};

export function parseReceiptDraft(text: string): ReceiptDraft {
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid receipt response.');
  const d = value as Record<string, unknown>;
  if (typeof d.description !== 'string' || d.description.length > 200 ||
      !(d.amount === null || typeof d.amount === 'string' && d.amount.length <= 20) ||
      !(d.currency === null || typeof d.currency === 'string' && Object.hasOwn(currencies, d.currency)) ||
      !(d.expense_date === null || typeof d.expense_date === 'string') ||
      !expenseCategories.includes(d.category as typeof expenseCategories[number]) ||
      !Array.isArray(d.warnings) || d.warnings.length > 10 || d.warnings.some(w => typeof w !== 'string' || w.length > 500)) {
    throw Error('Invalid receipt response.');
  }
  const warnings = [...d.warnings] as string[];
  let amount = d.amount as string | null;
  const currency = d.currency as Currency | null;
  if (amount !== null) {
    try {
      if (currency) { if (minor(amount, currency) <= 0) throw Error(); }
      else if (!/^\d{1,10}(?:\.\d{1,3})?$/.test(amount) || Number(amount) <= 0) throw Error();
    } catch { amount = null; warnings.push('The total could not be validated. Enter the paid amount manually.'); }
  }
  let date = d.expense_date as string | null;
  if (date !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) {
    date = null; warnings.push('Check the receipt date and enter it manually.');
  }
  if (!currency) warnings.push('Currency is unclear. Choose it before saving.');
  if (!amount) warnings.push('Confirm the final paid total, including any tax and tip.');
  if (!date) warnings.push('The date is unclear. Choose the expense date.');
  return { description: d.description.trim(), amount, currency, expense_date: date, category: d.category as ReceiptDraft['category'], warnings };
}

export function receiptImage(input: unknown): { mimeType: string; data: string } {
  if (!input || typeof input !== 'object') throw Error('Choose a receipt image.');
  const { mimeType, data } = input as Record<string, unknown>;
  if (typeof mimeType !== 'string' || !['image/jpeg', 'image/png', 'image/webp'].includes(mimeType) ||
      typeof data !== 'string' || !data.length || data.length > Math.ceil(receiptMaxBytes / 3) * 4 ||
      data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw Error('Upload a JPEG, PNG or WebP image up to 2 MB.');
  const bytes = Buffer.from(data, 'base64');
  if (!bytes.length || bytes.length > receiptMaxBytes || bytes.toString('base64') !== data) throw Error('Invalid receipt image.');
  const valid = mimeType === 'image/jpeg' ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : mimeType === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!valid) throw Error('The file does not match its image type.');
  return { mimeType, data };
}

export async function receiptRequestBody(request: Request) {
  const max = Math.ceil(receiptMaxBytes / 3) * 4 + 1024;
  const length = request.headers.get('content-length');
  if (length && Number(length) > max) throw Error('Upload an image up to 2 MB.');
  const reader = request.body?.getReader();
  if (!reader) throw Error('Choose a receipt image.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) { await reader.cancel(); throw Error('Upload an image up to 2 MB.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return receiptImage(JSON.parse(Buffer.concat(chunks).toString('utf8')));
}
