import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { createMarkdown, markdownFilename } from '../extension/markdown.js';

test('converts structured content with metadata and absolute URLs', () => {
  const { window } = new JSDOM('');
  const result = createMarkdown(
    {
      title: 'Article',
      url: 'https://example.com/story',
      baseUrl: 'https://example.com/assets/',
      content:
        '<h1>Article</h1><h2>Details</h2><p><a href="../guide">Guide</a><img src="photo.png" alt="Photo"></p><ul><li>Item</li></ul><blockquote>Quote</blockquote><pre><code class="language-js">const x = 1;</code></pre><table><thead><tr><th>Key</th><th>Value</th></tr></thead><tbody><tr><td>A</td><td>B</td></tr></tbody></table><p><del>Old</del></p>',
    },
    window.document,
    'Source'
  );
  assert.ok(result.startsWith('# Article\n\nSource: <https://example.com/story>'));
  assert.equal(result.match(/^# Article$/gm).length, 1);
  assert.match(result, /-\s+Item/);

  for (const text of [
    '## Details',
    '[Guide](https://example.com/guide)',
    '![Photo](https://example.com/assets/photo.png)',
    '> Quote',
    '```js',
    'const x = 1;',
    '| Key | Value |',
    '~Old~',
  ]) {
    assert.ok(result.includes(text), text);
  }

  window.close();
});

test('excludes scripts and unsafe link URLs', () => {
  const { window } = new JSDOM('');
  const markdown = createMarkdown(
    {
      title: 'Title',
      url: 'https://example.com',
      baseUrl: 'https://example.com',
      content: '<p>Text <a href="javascript:alert(1)">link</a></p><script>alert(2)</script>',
    },
    window.document,
    'Source'
  );
  assert.ok(!markdown.includes('javascript:'));
  assert.ok(!markdown.includes('alert(2)'));
  window.close();
});

test('creates portable filenames with Unicode and safe fallbacks', () => {
  assert.equal(markdownFilename('Статья: HTML/Markdown?'), 'Статья- HTML-Markdown-.md');
  assert.equal(markdownFilename('  ... '), 'page.md');
  assert.equal(markdownFilename('CON'), '_CON.md');
  assert.ok(markdownFilename('a'.repeat(200)).length <= 103);
});

test('rejects empty converted content', () => {
  const { window } = new JSDOM('');
  assert.throws(() =>
    createMarkdown(
      { title: 'Title', content: '', url: 'https://example.com' },
      window.document,
      'Source'
    )
  );
  window.close();
});
