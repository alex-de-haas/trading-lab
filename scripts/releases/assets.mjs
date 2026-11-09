import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, posix, resolve, sep } from 'node:path';
import { relativePath } from './context.mjs';

/** Preserve manifest-relative catalog/navigation files, including local Markdown references. */
export function releaseFiles(root, manifest) {
  const boundary = realpathSync(root) + sep, files = new Map();
  function add(path) {
    if (!path || /^https?:\/\//i.test(path)) return;
    relativePath(path);
    if (files.has(path)) return;
    const full = resolve(root, path), stat = lstatSync(full);
    if (!realpathSync(full).startsWith(boundary) || !stat.isFile() || stat.isSymbolicLink()) throw new Error('Release assets must be contained regular files.');
    const data = readFileSync(full);
    if (data.length > 16 * 1024 * 1024 || files.size >= 100) throw new Error('Release asset package is too large.');
    files.set(path, { path, data });
    if (path.endsWith('.md')) {
      const markdown = data.toString('utf8'), references = [];
      for (const match of markdown.matchAll(/!?\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))/g)) references.push(match[1] ?? match[2]);
      for (const match of markdown.matchAll(/^ {0,3}\[[^\]]+\]:\s*(?:<([^>]+)>|([^\s]+))/gm)) references.push(match[1] ?? match[2]);
      for (const match of markdown.matchAll(/<(?:img|a)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) references.push(match[1]);
      for (const reference of references) {
        if (/^(?:https?:|#)/i.test(reference)) continue;
        if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(reference)) throw new Error('Unsupported release asset URL.');
        const decoded = decodeURIComponent(reference.split(/[?#]/, 1)[0]);
        if (decoded) add(posix.normalize(posix.join(dirname(path).replaceAll('\\', '/'), decoded)));
      }
    }
  }
  for (const item of manifest.ui?.navigation ?? []) add(item.iconAsset);
  add(manifest.catalogMetadata?.icon);
  add(manifest.catalogMetadata?.descriptionFile);
  for (const image of manifest.catalogMetadata?.screenshots ?? []) add(image);
  if (manifest.agent?.skills?.length) throw new Error('This app-specific publisher does not package agent skills.');
  return [...files.values()].sort((a, b) => a.path.localeCompare(b.path, 'en'));
}
