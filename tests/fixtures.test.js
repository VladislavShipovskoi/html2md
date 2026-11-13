import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { analyzePage } from '../core/index.js';
import { createMarkdown } from '../core/index.js';

const cases = {
  'inline-code.html': {
    includes: ['`for...of`', '`+`', '`x + y`', '`value` — значение узла', '`None`/`null`/`nil`'],
    excludes: ['```'],
  },
  'standard-code.html': {
    includes: [
      "```javascript\nfunction render(value) {\n  const tag = '<strong>'\n\n  return tag + value + '</strong>'\n}",
      "```\nconsole.log('hello')\n```",
      '    print("ready")\n    print("done")',
      "````markdown\n```js\nconsole.log('nested')\n```\n````",
    ],
  },
  'highlighted-code.html': {
    includes: [
      '```js\nconst total = 1;\nconsole.log(total)\n```',
      '```go\nfmt.Println("original")\n```',
    ],
    excludes: ['fmt.Println("duplicate")', 'Copy'],
  },
  'line-based-code.html': {
    includes: [
      '```python\ndef greet(name):\n    print(name)\n\ngreet("World")\n```',
      '```js\nconst count = 2\n\n  console.log(count)\n```',
      '```sql\nSELECT name\nFROM users\n\nWHERE active = true;\n```',
      '```\nfirst()\n  second()\n```',
    ],
  },
  'aria-language-tabs.html': {
    includes: [
      'Use `None` for a missing value.',
      '```python\nprint("hello")\n```',
      '```java\nSystem.out.println("hello");\n```',
      '#### C#\n\n```csharp\nConsole.WriteLine("hello");\n```',
    ],
  },
  'lms-language-tabs.html': {
    includes: [
      '```python\nfor value in values:\n    print(value)\n```',
      '```javascript\nfor (const value of values) {\n  console.log(value)\n}\n```',
      '```go\nfmt.Println("hello")\n```',
      '#### C++\n\n```cpp\nstd::cout << "hello";\n```',
    ],
  },
  'dual-code-versions.html': {
    includes: [
      "#### JavaScript\n\n```js\nfunction* getLangs() {\n  yield 'js'\n}\n\nfor (const item of getLangs()) {\n  console.log(item)\n}\n```",
    ],
    excludes: ['Copy code', "yield 'js';"],
  },
};

test('every HTML fixture has conversion expectations', async () => {
  const files = await readdir(new URL('./fixtures/', import.meta.url));
  assert.deepEqual(
    files.filter((file) => file.endsWith('.html')).sort(),
    Object.keys(cases).sort()
  );
});

for (const [file, expected] of Object.entries(cases)) {
  for (const extraction of [false, true]) {
    test(`${file}: ${extraction ? 'Readability and Markdown' : 'direct Markdown'}`, async () => {
      const html = await readFile(new URL(`./fixtures/${file}`, import.meta.url), 'utf8');
      const { window } = new JSDOM(html, { url: 'https://example.com/article' });
      try {
        const before = window.document.documentElement.outerHTML;
        const article = extraction
          ? analyzePage(window.document)
          : {
              title: 'Example',
              content: html,
              url: window.document.URL,
              baseUrl: window.document.baseURI,
            };
        const markdown = createMarkdown(article, window.document, 'Source');

        for (const snippet of expected.includes) {
          assert.ok(markdown.includes(snippet), `Missing expected content: ${snippet}`);
          assert.equal(markdown.split(snippet).length - 1, 1, 'Content must not be duplicated');
        }

        for (const snippet of expected.excludes ?? []) {
          assert.ok(!markdown.includes(snippet), `Unexpected content: ${snippet}`);
        }

        assert.equal(window.document.documentElement.outerHTML, before);
      } finally {
        window.close();
      }
    });
  }
}
