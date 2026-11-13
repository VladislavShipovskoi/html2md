import { mockNotionApi } from './api-helper.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { prepareNotionExport as prepareContent } from '../core/notion/index.ts';
import { exportNotionArticle } from '../core/notion/index.ts';
import { createNotionApi } from '../core/notion/index.ts';
import { createMessageFormatter } from '../extension/shared/messages.ts';
import { notionRequest, uploadNotionImage, notionChildren } from '../core/notion/index.ts';

const parentId = '123456781234123412341234567890ab';
const t = (key: string, value?: string | string[]) =>
  `${key}${value === undefined ? '' : ':' + value}`;
const formatImageError = createMessageFormatter(t).imageError;
const prepareNotionExport = (source, document) =>
  prepareContent(source, document, {
    sourceLabel: t('sourceLabel'),
    formatImageError,
    createId: () => crypto.randomUUID(),
  });
const article = (content) => ({
  title: 'Article',
  url: 'https://source.test/article',
  baseUrl: 'https://source.test/',
  content,
});

function prepare(content) {
  const { window } = new JSDOM('');
  const source = article(content);
  const state = prepareNotionExport(source, window.document);
  window.close();
  return state;
}

function server(state, behavior: Record<string, any> = {}) {
  const blocks = [];
  const requests = [];
  let uploads = 0;
  let appends = 0;
  let deletes = 0;
  const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
  const fetcher = async (url, options) => {
    assert.ok(url.startsWith('https://api.notion.com/v1/'));
    assert.equal(options.headers.Authorization, 'Bearer token');
    assert.equal(options.redirect, 'error');
    const path = url.slice('https://api.notion.com/v1/'.length);
    const body =
      options.body instanceof FormData
        ? options.body
        : options.body
          ? JSON.parse(options.body)
          : undefined;
    requests.push({ path, method: options.method, body });

    if (path === 'pages') {
      return response({ id: parentId });
    }

    if (path.endsWith('/markdown')) {
      blocks.splice(
        0,
        blocks.length,
        ...state.occurrences.map((item, index) => ({
          id: `marker-${index}`,
          type: 'paragraph',
          paragraph: { rich_text: [{ text: { content: item.marker } }] },
        }))
      );
      return response({});
    }

    if (path === 'file_uploads') {
      uploads++;
      return response({ id: 'upload-' + uploads });
    }

    if (path.endsWith('/send')) {
      assert.ok(body instanceof FormData);
      assert.equal(options.headers['Content-Type'], undefined);

      if (behavior.uploadFailure) {
        return response({}, 400);
      }

      return response({ status: 'uploaded' });
    }

    if (path.endsWith('/children') && options.method === 'GET') {
      return response({ results: structuredClone(blocks), has_more: false });
    }

    if (path.endsWith('/children') && options.method === 'PATCH') {
      appends++;

      if (behavior.noCommit) {
        throw new Error('lost request');
      }

      const image = { ...structuredClone(body.children[0]), id: 'inserted-' + appends };
      const index = blocks.findIndex((block) => block.id === body.position.after_block.id);
      assert.ok(index >= 0);
      blocks.splice(index + 1, 0, image);

      if (behavior.lostAppend) {
        behavior.lostAppend = false;
        throw new Error('lost response');
      }

      return response({ results: [image] });
    }

    const id = path.split('/').at(-1);
    const index = blocks.findIndex((block) => block.id === id);
    assert.ok(index >= 0, path);

    if (options.method === 'DELETE') {
      deletes++;

      if (behavior.deleteFailure) {
        behavior.deleteFailure = false;
        return response({}, 503);
      }

      blocks.splice(index, 1);
      return response({ id });
    }

    if (body.image) {
      blocks[index].image.caption = body.image.caption;
    } else {
      blocks[index][blocks[index].type].rich_text = body[blocks[index].type].rich_text;
    }

    return response({ id });
  };

  return {
    fetcher,
    blocks,
    requests,
    get uploads() {
      return uploads;
    },
    get appends() {
      return appends;
    },
    get deletes() {
      return deletes;
    },
  };
}

const downloaded = async (urls) =>
  urls.map((url) => ({ url, type: 'image/png', bytes: [1, 2, 3] }));

const run = (state, api, downloadImages = downloaded) =>
  exportNotionArticle({
    state,
    api: createNotionApi({ token: 'token', fetcher: api.fetcher, sleep: async () => {} }),
    parentId,
    title: 'Tab title',
    downloadImages,
    formatImageError,
  });

test('prepares standalone markers in links, lists and quotes without changing source or code', () => {
  const source = article(
    '<p>Before <a href="/x"><img src="/a.png" alt="A"></a> after</p><ul><li>List <img src="/a.png"></li></ul><blockquote><p>Quote <img src="/b.png"></p></blockquote>'
  );
  const { window } = new JSDOM('');
  const state = prepareNotionExport(source, window.document);
  assert.equal(state.occurrences.length, 3);
  assert.ok(state.markdown.includes('Before'));
  assert.ok(state.markdown.includes('after'));
  assert.ok(state.markdown.includes('List'));
  assert.ok(state.markdown.includes('Quote'));

  for (const item of state.occurrences) {
    assert.ok(state.markdown.includes(item.marker));
  }

  assert.ok(source.content.includes('<img'));
  window.close();
});
test('uploads a repeated URL once, attaches all occurrences in order and removes markers', async () => {
  const state = prepare(
    '<p>Before</p><img src="/a.png" alt="First"><p>Between</p><img src="/a.png" alt="Second"><p>After</p>'
  );
  const api = server(state);
  await run(state, api, async (urls) => {
    assert.deepEqual(urls, ['https://source.test/a.png']);
    return downloaded(urls);
  });
  assert.equal(api.uploads, 1);
  assert.equal(api.appends, 2);
  assert.deepEqual(
    api.blocks.map((block) => block.image.caption[0].text.content),
    ['First', 'Second']
  );
  assert.ok(api.blocks.every((block) => block.image.file_upload.id === 'upload-1'));
  assert.equal(state.failedCount, 0);
  await run(state, api);
  assert.equal(api.appends, 2);
});
test('download and upload failures become bold reasons instead of external images', async () => {
  for (const failure of [
    'http',
    'timeout',
    'network',
    'format',
    'size',
    'totalSize',
    'empty',
    'upload',
  ]) {
    const state = prepare('<img src="/a.png">');
    const api = server(state, { uploadFailure: failure === 'upload' });
    await run(state, api, async (urls) =>
      failure === 'upload'
        ? downloaded(urls)
        : [{ url: urls[0], failed: true, reason: failure, status: 404 }]
    );
    assert.equal(state.failedCount, 1);
    const text = api.blocks[0].paragraph.rich_text[0];
    assert.equal(text.annotations.bold, true);
    assert.ok(
      text.text.content.includes(
        failure === 'http'
          ? '404'
          : failure === 'upload'
            ? 'imageUpload'
            : {
                timeout: 'imageTimeout',
                network: 'imageNetwork',
                format: 'imageFormat',
                size: 'imageSize',
                totalSize: 'imageTotalSize',
                empty: 'imageEmpty',
              }[failure]
      )
    );
    assert.equal(api.appends, 0);
  }
});
test('unsupported table and code positions contain error text and no upload markers', () => {
  const state = prepare(
    '<table><tr><th>Image</th></tr><tr><td><img src="/a.png"></td></tr></table><pre><img src="/a.png"></pre>'
  );
  assert.equal(state.initialFailures, 2);
  assert.equal(state.occurrences.length, 0);
  assert.ok(state.markdown.includes('**notionImageError:imageLocation:**'));
  assert.ok(!state.markdown.includes('H2MDIMAGE'));
});
test('cleanup retry does not duplicate images or rewrite the page', async () => {
  const state = prepare('<img src="/a.png">');
  const api = server(state, { deleteFailure: true });
  await assert.rejects(run(state, api));
  await run(state, api);
  assert.equal(api.uploads, 1);
  assert.equal(api.appends, 1);
  assert.equal(api.requests.filter((request) => request.path.endsWith('/markdown')).length, 1);
  assert.equal(api.blocks.length, 1);
  assert.equal(state.occurrences[0].status, 'complete');
});
test('lost append response is reconciled by its marker caption', async () => {
  const state = prepare('<img src="/a.png">');
  const api = server(state, { lostAppend: true });
  await run(state, api);
  assert.equal(api.appends, 1);
  assert.equal(api.blocks.length, 1);
});
test('an unconfirmed insertion is never blindly repeated', async () => {
  const state = prepare('<img src="/a.png">');
  const api = server(state, { noCommit: true });
  await assert.rejects(run(state, api), /notionImageUncertain/);
  await assert.rejects(run(state, api), /notionImageUncertain/);
  assert.equal(api.appends, 1);
});
test('429 and 529 obey Retry-After and stop after three retries', async () => {
  const waits = [];
  let calls = 0;
  await assert.rejects(
    notionRequest(
      'token',
      'file_uploads',
      {},
      async () => {
        calls++;
        return {
          ok: false,
          status: calls % 2 ? 429 : 529,
          headers: { get: () => '2' },
          json: async () => ({}),
        };
      },
      {
        sleep: async (ms) => {
          waits.push(ms);
        },
      }
    ),
    /notionRateLimited/
  );
  assert.equal(calls, 4);
  assert.deepEqual(waits, [2000, 2000, 2000]);
});
test('image uploads accept PNG, JPEG, GIF and WebP; unsupported formats do not call API', async () => {
  for (const type of ['image/png', 'image/jpeg', 'image/gif', 'image/webp']) {
    const result = await uploadNotionImage(
      'token',
      { url: 'https://example.com/image', type, bytes: [1] },
      async (url, options) => {
        if (options.body instanceof FormData) {
          assert.equal(options.headers['Content-Type'], undefined);
          return { ok: true, json: async () => ({ status: 'uploaded' }) };
        }

        return { ok: true, json: async () => ({ id: 'upload' }) };
      }
    );
    assert.equal(result, 'upload');
  }

  await assert.rejects(
    uploadNotionImage(
      'token',
      { url: 'https://example.com/image', type: 'image/unknown', bytes: [1] },
      () => assert.fail()
    ),
    /notionImageFormat/
  );
});
test('block retrieval follows pagination without sending a body', async () => {
  let calls = 0;
  const children = await notionChildren('token', 'parent', async (url, options) => {
    calls++;
    assert.equal(options.method, 'GET');
    assert.equal(options.body, undefined);

    if (calls === 2) {
      assert.ok(url.endsWith('?start_cursor=next'));
    }

    return {
      ok: true,
      json: async () => ({
        results: [{ id: String(calls) }],
        has_more: calls === 1,
        next_cursor: 'next',
      }),
    };
  });
  assert.deepEqual(
    children.map((block) => block.id),
    ['1', '2']
  );
});

test('workflow uses a narrow API and reports domain progress without localization keys', async () => {
  const state = prepare('<p>Text</p>');
  const events = [];
  let created = 0;
  let written = 0;
  const api = mockNotionApi({
    createPage: async () => {
      created++;
      return { id: parentId };
    },
    writeMarkdown: async () => {
      written++;
    },
  });
  await exportNotionArticle({
    state,
    api,
    parentId,
    title: 'Title',
    formatImageError,
    downloadImages: async (urls, progress) => {
      assert.deepEqual(urls, []);
      progress(0);
      return [];
    },
    progress: (event) => events.push(event),
  });
  assert.deepEqual(events, [{ stage: 'download', completed: 0, total: 0 }]);
  assert.equal(state.creation, 'confirmed');
  assert.equal(state.writing, 'confirmed');
  await exportNotionArticle({
    state,
    api,
    parentId,
    title: 'Title',
    formatImageError,
    downloadImages: async () => [],
  });
  assert.equal(created, 1);
  assert.equal(written, 1);
});

test('uncertain page creation is never repeated after refactoring state', async () => {
  const state = prepare('<p>Text</p>');
  let calls = 0;
  const api = mockNotionApi({
    createPage: async () => {
      calls++;
      throw Object.assign(new Error('notionSaveError'), { ambiguous: true });
    },
  });
  const input = {
    state,
    api,
    parentId,
    title: 'Title',
    formatImageError,
    downloadImages: async () => [],
  };
  await assert.rejects(exportNotionArticle(input), /notionSaveError/);
  assert.equal(state.creation, 'uncertain');
  await assert.rejects(exportNotionArticle(input), /notionImageUncertain/);
  assert.equal(calls, 1);
});

test('uncertain text write is checked instead of repeating a confirmed write', async () => {
  const state = prepare('<img src="/a.png">');
  const api = server(state);
  const original = api.fetcher;
  let writes = 0;
  api.fetcher = async (url, options) => {
    const result = await original(url, options);

    if (url.endsWith('/markdown')) {
      writes++;
      throw new Error('lost response');
    }

    return result;
  };
  await assert.rejects(run(state, api), /notionSaveError/);
  assert.equal(state.writing, 'uncertain');
  await run(state, api);
  assert.equal(writes, 1);
  assert.equal(state.writing, 'confirmed');
  assert.equal(state.occurrences[0].status, 'complete');
});

test('list image insertion preserves its containing block and existing children', async () => {
  const state = prepare('<ul><li><img src="/a.png"><ul><li>Keep me</li></ul></li></ul>');
  const calls = [];
  const api = mockNotionApi({
    createPage: async () => ({ id: parentId }),
    writeMarkdown: async () => {},
    uploadImage: async () => 'upload',
    children: async () => [
      {
        id: 'list',
        type: 'bulleted_list_item',
        has_children: true,
        bulleted_list_item: { rich_text: [{ text: { content: state.occurrences[0].marker } }] },
      },
    ],
    appendImage: async (input) => {
      calls.push(input);
      return 'image';
    },
    setCaption: async () => {},
    clearMarker: async (id, type) => {
      assert.equal(id, 'list');
      assert.equal(type, 'bulleted_list_item');
    },
    removeBlock: () => assert.fail('Must not delete a list container'),
  });
  await exportNotionArticle({
    state,
    api,
    parentId,
    title: 'Title',
    downloadImages: downloaded,
    formatImageError,
  });
  assert.equal(calls[0].targetId, 'list');
  assert.equal(calls[0].container, true);
  assert.equal(state.occurrences[0].status, 'complete');
});

test('lost marker deletion is reconciled without a second deletion', async () => {
  const state = prepare('<img src="/a.png">');
  const api = server(state);
  const original = api.fetcher;
  let deletes = 0;
  api.fetcher = async (url, options) => {
    const result = await original(url, options);

    if (options.method === 'DELETE') {
      deletes++;
      throw new Error('lost delete response');
    }

    return result;
  };
  await assert.rejects(run(state, api));
  assert.equal(state.occurrences[0].cleanup, 'uncertain');
  await run(state, api);
  assert.equal(deletes, 1);
  assert.equal(api.appends, 1);
  assert.equal(state.occurrences[0].cleanup, 'confirmed');
});
