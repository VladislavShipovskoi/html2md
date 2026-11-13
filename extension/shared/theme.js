/** A shared, non-secret preference. No integration credentials are read here. */
export async function initializeTheme({ document, storage, t }) {
  const button = document.getElementById('theme-toggle');
  const root = document.documentElement;
  let theme = 'light';
  let revision = 0;
  const apply = (value) => {
    theme = value === 'dark' ? 'dark' : 'light';
    root.dataset.theme = theme;
    button.setAttribute('aria-pressed', String(theme === 'dark'));
    button.setAttribute('aria-label', t('darkTheme'));
    button.title = t(theme === 'dark' ? 'switchToLightTheme' : 'switchToDarkTheme');
  };
  const changed = (changes, area) => {
    if (area === 'local' && changes.theme) {
      revision++;
      apply(changes.theme.newValue);
    }
  };
  storage?.onChanged?.addListener(changed);
  document.defaultView.addEventListener(
    'pagehide',
    () => {
      storage?.onChanged?.removeListener(changed);
    },
    { once: true }
  );
  apply(theme);
  button.disabled = true;
  try {
    const initialRevision = revision;
    const saved = await storage?.local.get('theme');

    if (initialRevision === revision) {
      apply(saved?.theme);
    }
  } catch {
    // A failed read should not prevent using the interface or retrying a save.
  } finally {
    button.disabled = false;
  }
  button.addEventListener('click', async () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    button.disabled = true;
    document.getElementById('theme-message').textContent = '';
    try {
      await storage?.local.set({ theme: next });
      apply(next);
    } catch {
      button.title = t('themeSaveError');
      document.getElementById('theme-message').textContent = t('themeSaveError');
    } finally {
      button.disabled = false;
    }
  });
}
