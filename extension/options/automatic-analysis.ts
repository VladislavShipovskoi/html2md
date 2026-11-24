import type { Translate } from '../shared/types.ts';

export type SitePermissions = Pick<typeof chrome.permissions, 'contains' | 'request' | 'remove'>;
const sites = { origins: ['http://*/*', 'https://*/*'] };

export function initializeAutomaticAnalysis(
  document: Document,
  permissions: SitePermissions | undefined,
  t: Translate
) {
  const toggle = document.querySelector<HTMLInputElement>('#automatic-analysis')!;
  const message = document.getElementById('automatic-analysis-message')!;

  if (!permissions) {
    return;
  }

  async function refresh() {
    toggle.checked = await permissions!.contains(sites);
  }
  toggle.addEventListener('change', () => {
    const previous = !toggle.checked;
    toggle.disabled = true;
    message.textContent = '';
    // Request directly in the event handler to preserve the user gesture.
    const operation = toggle.checked ? permissions.request(sites) : permissions.remove(sites);
    void operation
      .then(refresh)
      .catch(() => {
        toggle.checked = previous;
        message.textContent = t('automaticAnalysisError');
      })
      .finally(() => {
        toggle.disabled = false;
      });
  });
  void refresh()
    .then(() => {
      toggle.disabled = false;
    })
    .catch(() => {
      message.textContent = t('automaticAnalysisError');
    });
}
