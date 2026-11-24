import { failure } from '../../core/errors.ts';

export interface ActiveSourceHost {
  windows: { getCurrent(): Promise<{ id?: number }> };
  tabs: Pick<typeof chrome.tabs, 'onActivated' | 'onUpdated'>;
  runtime: Pick<typeof chrome.runtime, 'id' | 'getURL' | 'onMessage'>;
  permissions?: Pick<typeof chrome.permissions, 'onAdded' | 'onRemoved'>;
}
export async function watchActiveSource(
  host: ActiveSourceHost,
  onChange: (state: 'loading' | 'ready') => void
) {
  const { id: windowId } = await host.windows.getCurrent();

  if (!Number.isInteger(windowId)) {
    throw failure('noActiveTab');
  }

  const activated = (info: chrome.tabs.OnActivatedInfo) => {
    if (info.windowId === windowId) {
      onChange('ready');
    }
  };
  const updated = (_id: number, change: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab) => {
    if (tab.windowId !== windowId || !tab.active) {
      return;
    }

    if (change.status === 'loading') {
      onChange('loading');
    } else if (change.status === 'complete' || change.url) {
      onChange('ready');
    }
  };
  const accessGranted = (
    message: any,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void
  ) => {
    if (
      sender.id === host.runtime.id &&
      (!sender.url || sender.url === host.runtime.getURL('worker.js')) &&
      message?.channel === 'html2md-source-access' &&
      message.windowId === windowId
    ) {
      onChange('ready');
      sendResponse({ ok: true });
    }
  };
  host.tabs.onActivated.addListener(activated);
  host.tabs.onUpdated.addListener(updated);
  host.runtime.onMessage.addListener(accessGranted);
  const permissionsChanged = () => onChange('ready');
  host.permissions?.onAdded.addListener(permissionsChanged);
  host.permissions?.onRemoved.addListener(permissionsChanged);
  return {
    windowId: windowId!,
    dispose() {
      host.tabs.onActivated.removeListener(activated);
      host.tabs.onUpdated.removeListener(updated);
      host.runtime.onMessage.removeListener(accessGranted);
      host.permissions?.onAdded.removeListener(permissionsChanged);
      host.permissions?.onRemoved.removeListener(permissionsChanged);
    },
  };
}
