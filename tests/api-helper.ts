import assert from 'node:assert/strict';
import type { NotionApi } from '../core/notion/types.ts';
import { analyzePage } from '../core/index.ts';

export function analyzeHtml(document: Document) {
  const result = analyzePage(document);
  assert.equal(result.supported, true);

  if (!result.supported) {
    throw new Error('Expected an HTML document');
  }

  return result;
}

const unexpected = async (): Promise<never> => {
  throw new Error('Unexpected Notion API call');
};

export function mockNotionApi(overrides: Partial<NotionApi>): NotionApi {
  return {
    createPage: unexpected,
    writeMarkdown: unexpected,
    children: unexpected,
    uploadImage: unexpected,
    appendImage: unexpected,
    setCaption: unexpected,
    clearMarker: unexpected,
    removeBlock: unexpected,
    writeImageError: unexpected,
    ...overrides,
  };
}
