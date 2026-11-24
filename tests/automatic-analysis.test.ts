import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { initializeAutomaticAnalysis } from '../extension/options/automatic-analysis.ts';

test('automatic analysis requests access on click, reflects denial, and revokes granted access', async (t) => {
  const { window } = new JSDOM(
    '<input id="automatic-analysis" type="checkbox" disabled><p id="automatic-analysis-message"></p>'
  );
  t.after(() => window.close());
  const toggle = window.document.querySelector<HTMLInputElement>('input')!;
  const sites = { origins: ['http://*/*', 'https://*/*'] };
  let granted = false;
  let approve = false;
  let requests = 0;
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  initializeAutomaticAnalysis(
    window.document,
    {
      contains: async () => granted,
      request: async (permissions) => {
        assert.deepEqual(permissions, sites);
        requests++;
        granted = approve;
        return granted;
      },
      remove: async (permissions) => {
        assert.deepEqual(permissions, sites);
        granted = false;
        return true;
      },
    },
    (key) => key
  );
  await flush();
  assert.equal(toggle.checked, false);
  toggle.click();
  assert.equal(requests, 1, 'Request must run directly during the click');
  await flush();
  assert.equal(toggle.checked, false, 'A denied request must not enable the setting');
  approve = true;
  toggle.click();
  await flush();
  assert.equal(toggle.checked, true);
  toggle.click();
  await flush();
  assert.equal(granted, false);
  assert.equal(toggle.checked, false);
});
