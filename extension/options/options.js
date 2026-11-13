import { failure } from '../../core/index.js';
import { initializeLocalization } from '../shared/localization.js';
import { createMessageFormatter } from '../shared/messages.js';
import { renderIntegrationForm, renderIntegrationTable } from './views.js';

export async function initializeOptions({ document, i18n, repository }) {
  const { t } = initializeLocalization(document, i18n);
  const messages = createMessageFormatter(t);
  const view = document.defaultView;
  const get = (id) => document.getElementById(id);
  let editing;
  let busy = false;
  let renderRequested = false;
  let renderedRoute;
  function setBusy(value) {
    busy = value;

    for (const button of document.querySelectorAll('main button')) {
      button.disabled = value;
    }
  }
  async function perform(action) {
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
  const navigate = (route) => {
    view.location.hash = route;
  };
  async function remove(id) {
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
    void perform(() => remove(editing));
  });
  await perform(async () => {
    await repository.initialize();
    await render();
  });
}
