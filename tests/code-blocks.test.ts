import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { createMarkdown } from '../core/index.ts';
import { normalizeCodeBlocks, extractCodeText, fencedCode } from '../core/index.ts';

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
