import { analyzeHtml } from './api-helper.ts';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { analyzePage } from '../core/index.ts';

function articlePage() {
  const paragraph =
    'This article describes how to preserve useful web content. It includes detailed explanations, practical examples, and guidance for readers. '.repeat(
      8
    );
  return new JSDOM(
    `<title>Example article</title><nav><a href="/">Navigation link</a></nav><article><h1>Example article</h1><p>${paragraph}</p><p>${paragraph}</p></article>`,
    { url: 'https://example.com' }
  );
}

test('reports no article on an empty page', () => {
  const { window } = new JSDOM('<title>Empty</title>');
  assert.equal(analyzeHtml(window.document).articleFound, false);
  window.close();
});

test('rejects non-HTML documents', () => {
  const { window } = new JSDOM('<root>Text</root>', {
    contentType: 'application/xml',
  });
  assert.deepEqual(analyzePage(window.document), { supported: false });
  window.close();
});

test('bundled script returns analysis on repeated injections', async () => {
  const script = await readFile(new URL('../dist/page-analysis.js', import.meta.url), 'utf8');
  const { window } = articlePage();
  const vm = await import('node:vm');
  const context = vm.createContext({ document: window.document, URL });

  for (let run = 0; run < 2; run++) {
    assert.equal(vm.runInContext(script, context).articleFound, true);
  }

  window.close();
});
