export function registerSidePanel(host: Pick<typeof chrome, 'runtime' | 'action' | 'sidePanel'>) {
  void host.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch((error) => {
    console.error('Could not configure the side panel.', error);
  });

  async function openPanel(windowId: number) {
    try {
      // Keep open() before any await: Chrome requires the click's user gesture.
      await host.sidePanel.open({ windowId });
    } catch (error) {
      console.error('Could not open the side panel.', error);
      return;
    }

    try {
      await host.runtime.sendMessage({ channel: 'html2md-source-access', windowId });
    } catch (error) {
      // A new panel analyzes the source on startup, before its listener is ready.
      if (!String(error).includes('Receiving end does not exist')) {
        console.error('Could not refresh side panel access.', error);
      }
    }
  }

  host.action.onClicked.addListener((tab) => {
    void openPanel(tab.windowId);
  });
}
