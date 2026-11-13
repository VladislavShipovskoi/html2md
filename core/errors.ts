export interface ErrorDetails {
  code?: string;
  reason?: string;
  imageReason?: string;
  status?: number;
  ambiguous?: boolean;
  message?: string;
  name?: string;
  cause?: unknown;
}
/** Read only safe fields; presentation code never exposes transport payloads. */
export function errorDetails(value: unknown): ErrorDetails {
  return typeof value === 'object' && value !== null ? (value as ErrorDetails) : {};
}
export function failure(code: string, details: ErrorDetails = {}) {
  return Object.assign(new Error(code), { code, ...details });
}
