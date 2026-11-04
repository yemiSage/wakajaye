import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export const agreementVersion = 3;
const template = readFileSync(process.cwd() + '/content/residential-tenancy-agreement.txt', 'utf8');

export function agreementForDate(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Lagos', day: 'numeric', month: 'long', year: 'numeric',
  }).formatToParts(now).map(part => [part.type, part.value]));
  const text = template.replace('{{day}}', parts.day).replace('{{month}}', parts.month).replace('{{year}}', parts.year);
  return { version: agreementVersion, date: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Africa/Lagos' }).format(now), text, sha256: createHash('sha256').update(text).digest('hex') };
}

export function agreementStyle(paragraph, index) {
  if (index === 0) return 'title';
  if (/^\d+\. [A-Z]/.test(paragraph)) return 'heading';
  if (/^Bank:/.test(paragraph) || /^Total Annual Payment:/.test(paragraph)) return 'payment';
  if (/^5\.4\./.test(paragraph)) return 'warning';
  return 'body';
}
