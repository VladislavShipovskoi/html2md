import { imageUrls } from '../images/images.js';
import { createArchive } from './image-archive.js';
import { markdownFilename } from '../markdown/markdown.js';

/** @returns {Promise<import('../types.js').ArchiveResult>} */
export async function exportArchive({ article, document, sourceLabel, downloadImages, progress }) {
  const images = await downloadImages(imageUrls(article, document), progress);
  const archive = createArchive(article, images, document, sourceLabel);
  return { ...archive, filename: markdownFilename(article.title).replace(/\.md$/, '.zip') };
}
