const languageAliases: Record<string, string> = {
  'c#': 'csharp',
  'c++': 'cpp',
};

const languageTitles: Record<string, string> = {
  python: 'Python',
  java: 'Java',
  go: 'Go',
  javascript: 'JavaScript',
  js: 'JavaScript',
  typescript: 'TypeScript',
  ts: 'TypeScript',
  csharp: 'C#',
  cpp: 'C++',
  c: 'C',
  html: 'HTML',
  css: 'CSS',
  json: 'JSON',
  sql: 'SQL',
  bash: 'Bash',
  rust: 'Rust',
};

function languageName(label: string | null | undefined) {
  const name = label?.trim().toLowerCase() ?? '';
  return languageAliases[name] ?? (/^[a-z0-9_+-]+$/.test(name) ? name : '');
}

function codeLanguage(code: Element, pre: Element) {
  const className = `${code.className} ${pre.className}`;
  return languageName(
    className.match(/(?:language|lang)-([a-z0-9_+#.-]+)/i)?.[1] ??
      code.getAttribute('data-language') ??
      code.getAttribute('data-lang') ??
      pre.getAttribute('data-language') ??
      pre.getAttribute('data-lang')
  );
}

const lineSelector = '.block-code__original-line, .line, .code-line';

export function extractCodeText(node: Node): string {
  if (node.nodeType === 3) {
    return node.nodeValue ?? '';
  }

  if (node.nodeName === 'BR') {
    return '\n';
  }

  const children = [...node.childNodes];
  const meaningful = children.filter((child) => child.nodeType === 1 || child.textContent?.trim());
  const lines = meaningful.filter(
    (child) => child.nodeType === 1 && (child as Element).matches(lineSelector)
  );

  if (lines.length && lines.length === meaningful.length) {
    return lines.map(extractCodeText).join('\n');
  }

  return children.map(extractCodeText).join('');
}

function normalizePre(pre: Element, document: Document) {
  const candidates = [...pre.querySelectorAll('code')];
  const original = candidates.find((code) => code.querySelector('.block-code__original-line'));
  const source = original ?? candidates.find((code) => extractCodeText(code).trim()) ?? pre;
  const language = codeLanguage(source, pre);
  const cleanSource = source.cloneNode(true) as Element;
  cleanSource
    .querySelectorAll('button, script, style, .line-numbers-rows, .block-code__tools')
    .forEach((node) => node.remove());
  const code = document.createElement('code');
  code.textContent = extractCodeText(cleanSource).replace(/\r\n?/g, '\n');

  if (language) {
    code.className = `language-${language}`;
  }

  pre.replaceChildren(code);
}

function panelLabel(root: Document | Element, panel: HTMLElement) {
  const tabs = [...root.querySelectorAll('[role="tab"]')];
  const tab = tabs.find(
    (tab) =>
      (panel.id && tab.getAttribute('aria-controls') === panel.id) ||
      (tab.id && panel.getAttribute('aria-labelledby')?.split(/\s+/).includes(tab.id))
  );

  if (tab) {
    return tab.textContent;
  }

  const group = panel.closest('.lms-tabs');
  return [...(group?.querySelectorAll<HTMLElement>('[data-tabid]') ?? [])].find(
    (tab) => tab.dataset.tabid === panel.dataset.tabpane
  )?.textContent;
}

export function normalizeCodeBlocks(root: Document | Element) {
  const document = root.ownerDocument ?? (root as Document);

  for (const panel of root.querySelectorAll<HTMLElement>('[role="tabpanel"]')) {
    if (!panel.querySelector('code, pre')) {
      continue;
    }

    const language = languageName(panelLabel(root, panel));
    const section = document.createElement('section');

    for (const code of panel.querySelectorAll('code')) {
      const standalone = [...code.parentNode!.childNodes].every(
        (node) => node === code || !node.textContent?.trim()
      );

      if (language && (code.closest('pre') || standalone)) {
        code.className = `language-${language}`;
        wrapCodeBlock(code, document);
      }
    }

    section.append(...panel.childNodes);
    panel.replaceWith(section);
  }

  root.querySelectorAll('[role="tablist"], .lms-code-copy').forEach((node) => node.remove());

  for (const group of root.querySelectorAll('.lms-tabs')) {
    if (group.querySelector('pre, code')) {
      group.replaceWith(...group.childNodes);
    }
  }

  for (const code of root.querySelectorAll('code')) {
    if (/[\r\n]/.test(extractCodeText(code).trim())) {
      wrapCodeBlock(code, document);
    }
  }

  for (const pre of root.querySelectorAll('pre')) {
    normalizePre(pre, document);
  }
}

function wrapCodeBlock(code: Element, document: Document) {
  if (code.closest('pre')) {
    return;
  }

  const pre = document.createElement('pre');
  code.replaceWith(pre);
  pre.append(code);
}

export function fencedCode(node: HTMLElement) {
  const code = node.querySelector('code') ?? node;
  const language = codeLanguage(code, node);
  const text = extractCodeText(code).replace(/\r\n?/g, '\n').replace(/\n$/, '');
  const runs = text.match(/`+/g) ?? [];
  const fence = '`'.repeat(Math.max(3, ...runs.map((run) => run.length + 1)));
  const name = languageName(language);
  const heading = name ? `#### ${languageTitles[name] ?? name}\n\n` : '';
  return `\n\n${heading}${fence}${name}\n${text}\n${fence}\n\n`;
}
