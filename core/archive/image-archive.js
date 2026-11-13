import { zipSync, strToU8 } from 'fflate';
import { createMarkdown, markdownFilename } from '../markdown/markdown.js';

export function createArchive(article, images, document, sourceLabel) {
  const extensions = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/avif': 'avif',
    'image/bmp': 'bmp',
    'image/x-icon': 'ico',
  };
  const files = Object.create(null);
  const paths = new Map();
  const failed = [];

  for (const image of images) {
    if (image.failed || !image.bytes?.length) {
      failed.push(image.url);
      continue;
    }

    const path = `images/image-${paths.size + 1}.${extensions[image.type] || 'img'}`;
    files[path] = new Uint8Array(image.bytes);
    paths.set(image.url, path);
  }

  files[markdownFilename(article.title)] = strToU8(
    createMarkdown(article, document, sourceLabel, paths)
  );

  if (failed.length) {
    files['missing-images.txt'] = strToU8(failed.join('\n') + '\n');
  }

  return { bytes: zipSync(files), failedCount: failed.length };
}
