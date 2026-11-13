import { failure } from '../errors.ts';
export function notionPageId(value: string) {
  let candidate = value.trim();

  if (/^https?:/i.test(candidate)) {
    const url = new URL(candidate);

    if (url.protocol !== 'https:' || url.hostname !== 'app.notion.com') {
      throw failure('notionInvalidParent');
    }

    candidate = url.pathname.split('/').filter(Boolean).at(-1) ?? '';
  }

  const match = candidate.match(
    /(?:^|-)([a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i
  );

  if (!match) {
    throw failure('notionInvalidParent');
  }

  return match[1].replaceAll('-', '');
}
