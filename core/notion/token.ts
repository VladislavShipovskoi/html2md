export function normalizeToken(token: string) {
  return token
    .trim()
    .replace(/^Bearer\s+/i, '')
    .replace(/\s/g, '');
}
