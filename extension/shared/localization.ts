import type { Translate } from './types.ts';

export function initializeLocalization(document: Document, i18n: { getMessage: Translate }) {
  const t: Translate = (key, substitutions) => i18n.getMessage(key, substitutions);
  const locale = t('@@ui_locale').replaceAll('_', '-');
  document.documentElement.lang = locale;

  for (const element of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    element.textContent = t(element.dataset.i18n!);
  }

  return { t, locale };
}
