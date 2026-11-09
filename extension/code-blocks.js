const languageAliases = {
  'c#': 'csharp',
  'c++': 'cpp',
};

const languageTitles = {
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

function languageName(label) {
  const name = label?.trim().toLowerCase() ?? '';
  return languageAliases[name] ?? (/^[a-z0-9_+-]+$/.test(name) ? name : '');
}

function panelLabel(root, panel) {
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
  return [...(group?.querySelectorAll('[data-tabid]') ?? [])].find(
    (tab) => tab.dataset.tabid === panel.dataset.tabpane
  )?.textContent;
}

export function normalizeCodeBlocks(root) {
  const document = root.ownerDocument ?? root;

  for (const panel of root.querySelectorAll('[role="tabpanel"]')) {
    if (!panel.querySelector('code, pre')) {
      continue;
    }

    const language = languageName(panelLabel(root, panel));
    const section = document.createElement('section');

    for (const code of panel.querySelectorAll('code')) {
      const standalone = [...code.parentNode.childNodes].every(
        (node) => node === code || !node.textContent.trim()
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

  for (const code of root.querySelectorAll('code')) {
    if (/[\r\n]/.test(code.textContent.trim())) {
      wrapCodeBlock(code, document);
    }
  }
}

function wrapCodeBlock(code, document) {
  if (code.closest('pre')) {
    return;
  }

  const pre = document.createElement('pre');
  code.replaceWith(pre);
  pre.append(code);
}

export function fencedCode(node) {
  const code = node.querySelector('code') ?? node;
  const className = `${code.className} ${node.className}`;
  const language =
    className.match(/(?:language|lang)-([a-z0-9_+#.-]+)/i)?.[1] ??
    code.getAttribute('data-language') ??
    node.getAttribute('data-language');
  const text = code.textContent.replace(/\r\n?/g, '\n').replace(/\n$/, '');
  const runs = text.match(/`+/g) ?? [];
  const fence = '`'.repeat(Math.max(3, ...runs.map((run) => run.length + 1)));
  const name = languageName(language);
  const heading = name ? `#### ${languageTitles[name] ?? name}\n\n` : '';
  return `\n\n${heading}${fence}${name}\n${text}\n${fence}\n\n`;
}
