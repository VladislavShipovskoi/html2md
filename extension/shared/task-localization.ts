import type { Translate } from './types.ts';

export function createTaskTranslator(getURL: (path: string) => string, fetcher: typeof fetch) {
  type Catalog = Record<
    string,
    { message: string; placeholders?: Record<string, { content: string }> }
  >;
  const catalogs = new Map<string, Promise<Catalog>>();
  return async (locale: 'en' | 'ru'): Promise<Translate> => {
    if (!catalogs.has(locale)) {
      const loading = fetcher(getURL(`_locales/${locale}/messages.json`))
        .then((response) => {
          if (!response.ok) {
            throw new Error('Could not load task translations');
          }

          return response.json() as Promise<Catalog>;
        })
        .catch((error) => {
          catalogs.delete(locale);
          throw error;
        });
      catalogs.set(locale, loading);
    }

    const catalog = await catalogs.get(locale)!;
    return (key, substitutions) => {
      const entry = catalog[key];
      const values = Array.isArray(substitutions) ? substitutions : [substitutions ?? ''];
      return (entry?.message ?? key).replace(
        /\$([A-Z]+)\$/g,
        (_, name: string) =>
          values[Number(entry?.placeholders?.[name.toLowerCase()]?.content.slice(1)) - 1] ?? ''
      );
    };
  };
}
