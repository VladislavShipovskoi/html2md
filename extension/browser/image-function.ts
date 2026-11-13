import { fetchPageImages } from './images.ts';

export function fetchImagesInPage(urls: string[], maxTotalBytes: number) {
  return fetchPageImages(urls, maxTotalBytes, { document, fetcher: fetch });
}
