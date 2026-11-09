import { createHash } from 'node:crypto';

export const canonical = value => JSON.stringify(sort(value));
function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])]));
  return value;
}
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const fullCommit = value => /^[a-f0-9]{40}$/.test(value ?? '');
export const digest = value => /^sha256:[a-f0-9]{64}$/.test(value ?? '');
export function relativePath(value) {
  if (typeof value !== 'string' || !value || value.startsWith('/') || value.includes('\\')
    || value.split('/').some(part => !part || part === '.' || part === '..') || /[\x00-\x1f\x7f]/.test(value)) throw new Error('Unsafe release path.');
  return value;
}
export const jsonBytes = value => canonical(value) + '\n';
