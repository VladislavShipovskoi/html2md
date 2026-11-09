import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { analyzePage } from '../extension/page-analysis.js';
import { createMarkdown } from '../extension/markdown.js';
import { normalizeCodeBlocks } from '../extension/code-blocks.js';

function convert(html) {
  const { window } = new JSDOM('');
  try {
    return createMarkdown(
      {
        title: 'Example',
        url: 'https://example.com',
        baseUrl: 'https://example.com',
        content: html,
      },
      window.document,
      'Source'
    );
  } finally {
    window.close();
  }
}

test('converts standalone code tags to fenced blocks preserving whitespace and HTML text', () => {
  const markdown = convert('<p>Example <code>if (x) {\n  &lt;tag&gt;\n}</code></p>');
  assert.ok(markdown.includes('```\nif (x) {\n  <tag>\n}\n```'));
});

test('handles highlighted pre blocks, language metadata, and backticks inside code', () => {
  const markdown = convert(
    '<pre><span></span><code class="language-python"><span>print</span>(1)\n  ```\n</code></pre>'
  );
  assert.ok(markdown.includes('````python\nprint(1)\n  ```\n````'));
  assert.ok(markdown.includes('#### Python\n\n````python'));
});

test('adds language headings only to labelled blocks', () => {
  const markdown = convert(
    '<pre><code data-language="C#">x</code></pre><pre><code>y</code></pre><p><code class="language-python">name</code></p>'
  );
  assert.ok(markdown.includes('#### C#\n\n```csharp\nx\n```'));
  assert.ok(markdown.includes('```\ny\n```'));
  assert.equal(markdown.match(/^#### /gm).length, 1);
  assert.ok(markdown.includes('`name`'));
});

test('preserves every hidden LMS language tab through Readability without changing the source', () => {
  const labels = ['Python', 'Java', 'Go', 'JavaScript', 'C#'];
  const tabs = labels
    .map((name, index) => `<button role="tab" data-tabid="${index}">${name}</button>`)
    .join('');
  const panels = labels
    .map(
      (name, index) =>
        `<div role="tabpanel" data-tabpane="${index}" hidden><div class="codehilite"><pre><span></span><code>example_${index}();\n  next();</code></pre></div></div>`
    )
    .join('');
  const { window } = new JSDOM(
    `<title>Example</title><article><p>${'An explanation of programming examples, with details and descriptions. '.repeat(20)}</p><div class="lms-tabs"><div role="tablist">${tabs}</div>${panels}</div></article>`,
    { url: 'https://example.com' }
  );
  try {
    const before = window.document.body.innerHTML;
    const article = analyzePage(window.document);
    const markdown = createMarkdown(article, window.document, 'Source');

    for (const [index, language] of ['python', 'java', 'go', 'javascript', 'csharp'].entries()) {
      assert.ok(markdown.includes(`\`\`\`${language}\nexample_${index}();\n  next();`), language);
    }

    assert.equal(window.document.body.innerHTML, before);
  } finally {
    window.close();
  }
});

test('finds language labels using ARIA relationships', () => {
  const markdown = convert(
    '<div role="tablist"><button role="tab" id="label" aria-controls="java">Java</button></div><div role="tabpanel" id="java" aria-labelledby="label" hidden><pre><code>class Example {}</code></pre></div>'
  );
  assert.ok(markdown.includes('```java\nclass Example {}\n```'));
});

test('keeps list descriptions and inline identifiers on one line per item', () => {
  const markdown = convert(
    '<ul><li><code>value</code> — значение узла</li><li><code>left</code> — указатель на левого потомка (или <code>None</code>/<code>null</code>/<code>nil</code>)</li><li><code>right</code> — указатель на правого потомка</li></ul>'
  );
  const lines = markdown.split('\n').filter((line) => line.startsWith('-'));
  assert.deepEqual(
    lines.map((line) => line.replace(/^-\s+/, '')),
    [
      '`value` — значение узла',
      '`left` — указатель на левого потомка (или `None`/`null`/`nil`)',
      '`right` — указатель на правого потомка',
    ]
  );
  assert.ok(!markdown.includes('```'));
});

test('single words, symbols, expressions and externally padded lines stay inline', () => {
  const markdown = convert(
    '<p><code>value</code> <code>+</code> <code>x + y</code> <code>\n  null\n</code></p>'
  );
  assert.ok(markdown.includes('`value` `+` `x + y` `null`'));
  assert.ok(!markdown.includes('```'));
});

test('single-line pre and language tab examples remain blocks but explanations stay inline', () => {
  const markdown = convert(
    '<pre><code>x</code></pre><div class="lms-tabs"><div role="tablist"><button role="tab" data-tabid="0">Python</button></div><div role="tabpanel" data-tabpane="0" hidden><p>Use <code>None</code> here.</p><p><code>print(1)</code></p></div></div>'
  );
  assert.ok(markdown.includes('```\nx\n```'));
  assert.ok(markdown.includes('```python\nprint(1)\n```'));
  assert.ok(markdown.includes('Use `None` here.'));
});

test('normalization is idempotent and preserves indentation', () => {
  const { window } = new JSDOM(
    '<p><code>name</code> explanation</p><code>  first()\n    second()</code>'
  );
  try {
    normalizeCodeBlocks(window.document);
    const before = window.document.body.innerHTML;
    normalizeCodeBlocks(window.document);
    assert.equal(window.document.body.innerHTML, before);
    assert.equal(window.document.querySelector('pre code').textContent, '  first()\n    second()');
    assert.equal(window.document.querySelector('p pre'), null);
  } finally {
    window.close();
  }
});
