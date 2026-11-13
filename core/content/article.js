import { Readability } from '@mozilla/readability';
import { normalizeCodeBlocks } from './code-blocks.js';

/** @returns {{supported:false}|(import('../types.js').Article & {supported:true,articleFound:boolean})} */
export function analyzePage(document) {
  const supported = ['text/html', 'application/xhtml+xml'].includes(document.contentType);

  if (!supported) {
    return { supported: false };
  }

  const copy = document.cloneNode(true);
  normalizeCodeBlocks(copy);
  const codeClasses = [...copy.querySelectorAll('code, pre')].flatMap((node) => [
    ...node.classList,
  ]);
  const article = new Readability(copy, { classesToPreserve: codeClasses }).parse();
  const text = article?.textContent?.trim() ?? '';

  return {
    supported: true,
    title: article?.title || document.title,
    characters: text.length,
    articleFound: text.length > 0,
    content: article?.content ?? '',
    url: document.URL,
    baseUrl: document.baseURI,
  };
}
