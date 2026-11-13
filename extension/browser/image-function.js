import { fetchPageImages } from './images.js';

// The build replaces this module with a bundled, self-contained function.
export function fetchImagesInPage(urls, maxTotalBytes) {
  return fetchPageImages(urls, maxTotalBytes, { document, fetcher: fetch });
}
