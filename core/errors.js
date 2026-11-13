export function failure(code, details = {}) {
  return Object.assign(new Error(code), { code, ...details });
}
