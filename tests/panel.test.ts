import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerSidePanel } from '../extension/background/panel.ts';

function setup(t) {
  let click;
  const calls = [];
  const errors = t.mock.method(console, 'error', () => {});
  const host = {
    action: {
      onClicked: {
        addListener: (listener) => {
          click = listener;
        },
      },
    },
    sidePanel: {
      setPanelBehavior: async () => {},
      open: async (options) => {
        calls.push(options);
      },
    },
    runtime: {
      sendMessage: async (message) => {
        calls.push(message);
      },
    },
  };
  registerSidePanel(host as unknown as Parameters<typeof registerSidePanel>[0]);
  return {
    host,
    calls,
    errors,
    async click() {
      click({ windowId: 42 });
      assert.deepEqual(calls[0], { windowId: 42 }, 'Open must run during the click');
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

test('action opens the panel immediately and refreshes access in the same window', async (t) => {
  const panel = setup(t);
  await panel.click();
  assert.deepEqual(panel.calls, [
    { windowId: 42 },
    { channel: 'html2md-source-access', windowId: 42 },
  ]);
});

test('a loading panel is harmless; actual opening and refresh failures are reported separately', async (t) => {
  const panel = setup(t);
  panel.host.runtime.sendMessage = async () => {
    throw new Error('Could not establish connection. Receiving end does not exist.');
  };
  await panel.click();
  assert.equal(panel.errors.mock.callCount(), 0);

  const failure = new Error('Denied');
  panel.host.runtime.sendMessage = async () => {
    throw failure;
  };
  await panel.click();
  assert.deepEqual(panel.errors.mock.calls[0].arguments, [
    'Could not refresh side panel access.',
    failure,
  ]);

  panel.host.sidePanel.open = async (options) => {
    panel.calls.push(options);
    throw failure;
  };
  await panel.click();
  assert.deepEqual(panel.errors.mock.calls[1].arguments, [
    'Could not open the side panel.',
    failure,
  ]);
});
