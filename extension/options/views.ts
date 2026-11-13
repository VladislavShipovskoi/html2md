import type { Integration, Translate } from '../shared/types.ts';

export function renderIntegrationForm(
  document: Document,
  { record, adding, t }: { record?: Integration; adding: boolean; t: Translate }
) {
  const get = (id: string) => document.getElementById(id) as HTMLInputElement;
  get('detail-title').textContent = adding ? t('integrationAdd') : record!.name;
  get('integration-name').value = record?.name ?? '';
  get('notion-parent').value = record?.parentId ?? '';
  get('notion-token').value = '';
  get('notion-token').placeholder = t(
    record?.connected ? 'tokenReplacePlaceholder' : 'tokenPlaceholder'
  );
  get('connection-status').dataset.connected = String(Boolean(record?.connected));
  get('detail-delete').hidden = !record;
  get('connection-status').textContent = t(
    record?.connected ? 'notionConnected' : 'notionDisconnected'
  );
}
export function renderIntegrationTable(
  document: Document,
  records: Integration[],
  {
    t,
    onDelete,
    navigate,
  }: { t: Translate; onDelete: (id: string) => void; navigate: (route: string) => void }
) {
  const rows = document.getElementById('integration-rows')!;
  rows.replaceChildren();
  document.getElementById('integrations-empty')!.hidden = records.length > 0;

  for (const item of records) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    const link = document.createElement('a');
    link.href = `#integration/${item.id}`;
    link.textContent = item.name;
    cell.append(link);
    row.append(cell);

    for (const value of ['Notion', item.parentId]) {
      const td = document.createElement('td');
      td.textContent = value;

      if (value === item.parentId) {
        td.className = 'parent-cell';
      }

      row.append(td);
    }

    const statusCell = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.dataset.connected = String(Boolean(item.connected));
    badge.textContent = t(item.connected ? 'notionConnected' : 'notionDisconnected');
    statusCell.append(badge);
    row.append(statusCell);

    const actions = document.createElement('td');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'danger row-delete';
    button.innerHTML =
      '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7"/></svg>';
    button.title = t('integrationDelete');
    button.setAttribute('aria-label', `${t('integrationDelete')}: ${item.name}`);
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      onDelete(item.id);
    });
    actions.append(button);
    row.append(actions);
    row.addEventListener('click', (event) => {
      if (!(event.target as Element).closest('a, button')) {
        navigate(`integration/${item.id}`);
      }
    });
    rows.append(row);
  }
}
