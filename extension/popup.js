const statusEl = document.querySelector("#status");
const messageEl = document.querySelector("#message");
const mainEl = document.querySelector("main");
const t = (key, substitutions) => chrome.i18n.getMessage(key, substitutions);
const locale = chrome.i18n.getMessage("@@ui_locale").replaceAll("_", "-");

document.documentElement.lang = locale;

for (const element of document.querySelectorAll("[data-i18n]")) {
  element.textContent = t(element.dataset.i18n);
}

function showResult(available, explanation) {
  statusEl.dataset.state = available ? "available" : "unavailable";
  statusEl.textContent = available
    ? t("conversionAvailable")
    : t("conversionUnavailable");
  messageEl.textContent = explanation;
}

async function analyzePage() {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (!Number.isInteger(tab?.id)) {
      showResult(false, t("noActiveTab"));
      return;
    }

    const url = new URL(tab.url ?? "about:blank");
    const webStore =
      url.hostname === "chromewebstore.google.com" ||
      (url.hostname === "chrome.google.com" &&
        url.pathname.startsWith("/webstore"));

    if (!["http:", "https:"].includes(url.protocol) || webStore) {
      showResult(false, t("restrictedPage"));
      return;
    }

    const [{ result } = {}] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["page-analysis.js"],
    });

    if (!result) throw new Error("No analysis result");
    if (!result.supported) {
      showResult(false, t("unsupportedDocument"));
      return;
    }

    showResult(
      result.articleFound,
      result.articleFound ? t("textAvailable") : t("articleNotFound"),
    );

    document.querySelector("#page-title").textContent =
      result.title || tab.title || t("untitled");
    document.querySelector("#text-count").textContent = t(
      "characterCount",
      result.characters.toLocaleString(locale),
    );
    document.querySelector("#details").hidden = false;
  } catch {
    showResult(false, t("accessError"));
  } finally {
    mainEl.setAttribute("aria-busy", "false");
  }
}

analyzePage();
