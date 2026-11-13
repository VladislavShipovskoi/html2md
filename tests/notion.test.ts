import assert from 'node:assert/strict';
import { test } from 'node:test';
import { notionPageId, createNotionPage, writeNotionMarkdown } from '../core/notion/index.ts';

const id = '123456781234123412341234567890ab';

test('parent IDs accept Notion links and UUIDs and reject other hosts', () => {
  assert.equal(notionPageId(`https://app.notion.com/Articles-${id}?pvs=4`), id);
  assert.equal(notionPageId('12345678-1234-1234-1234-1234567890ab'), id);
  assert.throws(() => notionPageId(`https://example.com/${id}`), /notionInvalidParent/);
  assert.throws(() => notionPageId(`https://notion.so/${id}`), /notionInvalidParent/);
  assert.throws(() => notionPageId(`http://app.notion.com/${id}`), /notionInvalidParent/);
  assert.throws(() => notionPageId('not a page'), /notionInvalidParent/);
});

test('creates a child page and writes formatted Markdown with correct authentication', async () => {
  const requests = [];
  const fetcher = async (url, options) => {
    requests.push({ url, ...options, body: JSON.parse(options.body) });
    return { ok: true, json: async () => ({ id }) };
  };
  await createNotionPage('test-token', id, 'Article title', fetcher);
  await writeNotionMarkdown('test-token', id, '# Article\n\n**Text**', fetcher);
  assert.equal(requests[0].url, 'https://api.notion.com/v1/pages');
  assert.equal(requests[0].headers.Authorization, 'Bearer test-token');
  assert.equal(requests[0].body.parent.page_id, id);
  assert.equal(requests[0].body.properties.title.title[0].text.content, 'Article title');
  assert.equal(requests[1].method, 'PATCH');
  assert.equal(requests[1].body.replace_content.new_str, '# Article\n\n**Text**');
});

test('API errors do not expose the token or retry page creation', async () => {
  let calls = 0;
  await assert.rejects(
    createNotionPage('private-token', id, 'Title', async () => {
      calls++;
      return { ok: false, status: 401, json: async () => ({ message: 'private-token' }) };
    }),
    /notionUnauthorized/
  );
  assert.equal(calls, 1);
});

test('recovers the committed page ID from a 503 without creating a duplicate', async () => {
  const page = await createNotionPage('token', id, 'Title', async () => ({
    ok: false,
    status: 503,
    json: async () => ({ additional_data: { committed_resource_id: id } }),
  }));
  assert.equal(page.id, id);
});
