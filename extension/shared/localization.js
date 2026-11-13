export function initializeLocalization(document, i18n) {
  const t = (key, substitutions) => i18n.getMessage(key, substitutions);
  const locale = t('@@ui_locale').replaceAll('_', '-');
  document.documentElement.lang = locale;

  for (const element of document.querySelectorAll('[data-i18n]')) {
    element.textContent = t(element.dataset.i18n);
  }

  return { t, locale };
}
