import { Readability } from "@mozilla/readability";

export function analyzePage(document) {
  const supported = ["text/html", "application/xhtml+xml"].includes(
    document.contentType,
  );
  if (!supported) return { supported: false };

  const article = new Readability(document.cloneNode(true)).parse();
  const text = article?.textContent?.trim() ?? "";

  return {
    supported: true,
    title: article?.title || document.title,
    characters: text.length,
    articleFound: text.length > 0,
  };
}
