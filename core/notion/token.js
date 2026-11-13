export function normalizeToken(token) {
  return token
    .trim()
    .replace(/^Bearer\s+/i, '')
    .replace(/\s/g, '');
}
