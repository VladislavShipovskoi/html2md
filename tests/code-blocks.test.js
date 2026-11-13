import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { analyzePage } from '../core/index.js';
import { createMarkdown } from '../core/index.js';
import { normalizeCodeBlocks, extractCodeText, fencedCode } from '../core/index.js';

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

test('restores original lines from duplicate code versions through Readability', async () => {
  const html = await readFile(
    new URL('./fixtures/dual-code-versions.html', import.meta.url),
    'utf8'
  );
  const { window } = new JSDOM(html, { url: 'https://example.com' });
  try {
    const before = window.document.documentElement.outerHTML;
    const markdown = createMarkdown(analyzePage(window.document), window.document, 'Source');
    assert.ok(
      markdown.includes(
        "#### JavaScript\n\n```js\nfunction* getLangs() {\n  yield 'js'\n}\n\nfor (const item of getLangs()) {\n  console.log(item)\n}\n```"
      )
    );
    assert.equal(markdown.match(/function\* getLangs/g).length, 1);
    assert.ok(!markdown.includes('Copy code'));
    assert.equal(window.document.documentElement.outerHTML, before);
    normalizeCodeBlocks(window.document);
    const normalized = window.document.body.innerHTML;
    normalizeCodeBlocks(window.document);
    assert.equal(window.document.body.innerHTML, normalized);
  } finally {
    window.close();
  }
});

test('extracts explicit line groups and br without splitting highlighted tokens', () => {
  const { window } = new JSDOM('');
  try {
    for (const lineClass of ['line', 'code-line']) {
      const node = window.document.createElement('code');
      node.innerHTML = `<span class="${lineClass}"><span class="token">first</span>()</span>\n<span class="${lineClass}"></span>\n<span class="${lineClass}">  second()</span>`;
      assert.equal(extractCodeText(node), 'first()\n\n  second()');
    }

    const markdown = convert(
      '<pre data-lang="python"><code><span>print</span><span>(1)</span><br>  next()</code><code>duplicate</code></pre>'
    );
    assert.ok(markdown.includes('```python\nprint(1)\n  next()\n```'));
    assert.ok(!markdown.includes('duplicate'));
  } finally {
    window.close();
  }
});

test('selects the first nonempty code candidate and supports data-lang on code', () => {
  const markdown = convert(
    '<pre><code> </code><code data-lang="go">main()</code><code>duplicate</code><button>Copy</button></pre>'
  );
  assert.ok(markdown.includes('#### Go\n\n```go\nmain()\n```'));
  assert.ok(!markdown.includes('duplicate'));
  assert.ok(!markdown.includes('Copy'));
});

test('removes tools from code sources and skips empty tab containers', () => {
  const markdown = convert(
    '<div class="lms-tabs"><p>No examples</p></div><div role="tabpanel">Explanation only</div><pre><code class="language-customlang">run()<button>Copy</button><span class="line-numbers-rows">123</span></code></pre>'
  );
  assert.ok(markdown.includes('#### customlang\n\n```customlang\nrun()\n```'));
  assert.ok(!markdown.includes('Copy'));
  assert.ok(!markdown.includes('123'));
  assert.ok(markdown.includes('Explanation only'));
});

test('unlabelled code panels preserve code without inventing a language', () => {
  const markdown = convert('<div role="tabpanel" hidden><pre><code>run()</code></pre></div>');
  assert.ok(markdown.includes('```\nrun()\n```'));
  assert.ok(!markdown.includes('####'));
});

test('fenced code supports pre text without a code child and rejects invalid language labels', () => {
  const { window } = new JSDOM('<pre data-language="not a language">run()</pre>');
  try {
    assert.equal(fencedCode(window.document.querySelector('pre')), '\n\n```\nrun()\n```\n\n');
  } finally {
    window.close();
  }
});
