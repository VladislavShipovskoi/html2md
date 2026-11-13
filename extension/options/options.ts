import type { ThemeStorage, Translate } from '../shared/types.ts';
import type { createIntegrationRepository } from '../integrations/integrations.ts';
import { failure } from '../../core/index.ts';
import { initializeLocalization } from '../shared/localization.ts';
import { createMessageFormatter } from '../shared/messages.ts';
import { renderIntegrationForm, renderIntegrationTable } from './views.ts';
import { initializeTheme } from '../shared/theme.ts';

export async function initializeOptions({
  document,
  i18n,
  repository,
  themeStorage,
}: {
  document: Document;
  i18n: { getMessage: Translate };
  repository: ReturnType<typeof createIntegrationRepository>;
  themeStorage?: ThemeStorage;
}) {
  const { t } = initializeLocalization(document, i18n);
  await initializeTheme({ document, storage: themeStorage, t });
  const messages = createMessageFormatter(t);
  const view = document.defaultView!;
  const get = (id: string) => document.getElementById(id) as HTMLInputElement;
  let editing: string | undefined;
  let busy = false;
  let renderRequested = false;
  let renderedRoute: string | undefined;
  function setBusy(value: boolean) {
    busy = value;

    for (const button of document.querySelectorAll<HTMLButtonElement>('main button')) {
      button.disabled = value;
    }
  }
  async function perform(action: () => Promise<void>) {
    if (busy) {
      return;
    }

    setBusy(true);
    get('settings-message').textContent = '';
    try {
      await action();
    } catch (error) {
      get('settings-message').textContent = messages.error(error, 'notionSettingsError');
    } finally {
      setBusy(false);

      if (renderRequested) {
        renderRequested = false;

        if (view.location.hash.slice(1) !== renderedRoute) {
          void perform(render);
        }
      }
    }
  }
  const navigate = (route: string) => {
    view.location.hash = route;
  };
  async function remove(id: string) {
    await repository.remove(id);
    navigate('');
    await render();
  }
  async function render() {
    const records = await repository.list();
    const route = view.location.hash.slice(1);
    const adding = route === 'new';
    const record = records.find((item) => route === `integration/${item.id}`);
    get('integration-list').hidden = Boolean(route);
    get('integration-detail').hidden = !route;
    get('settings-form').hidden = Boolean(route) && !adding && !record;
    get('notion-token').value = '';
    get('detail-delete').hidden = !record;
    editing = record?.id;

    if (route && !adding && !record) {
      throw failure('integrationNotFound');
    }

    if (route) {
      renderIntegrationForm(document, { record, adding, t });
    } else {
      renderIntegrationTable(document, records, {
        t,
        navigate,
        onDelete: (id) => {
          void perform(() => remove(id));
        },
      });
    }

    renderedRoute = route;
  }
  view.addEventListener('hashchange', () => {
    if (view.location.hash.slice(1) === renderedRoute) {
      return;
    }

    if (busy) {
      renderRequested = true;
    } else {
      void perform(render);
    }
  });
  get('settings-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const input = {
      id: editing,
      name: get('integration-name').value,
      parentId: get('notion-parent').value,
      token: get('notion-token').value,
    };
    void perform(async () => {
      const id = await repository.save(input);
      navigate(`integration/${id}`);
      await render();
      get('settings-message').textContent = t('notionSettingsSaved');
    });
  });
  get('detail-delete').addEventListener('click', () => {
    void perform(() => remove(editing!));
  });
  await perform(async () => {
    await repository.initialize();
    await render();
  });
}
