/** The header every response of ITPO's services (and of the EMS API) carries. */
export interface ApiHeader {
  code: number;
  error: boolean;
  success: boolean;
  msg: string;
}

/** Every response: a header with the real status, and the data. */
export interface ApiEnvelope<T> {
  header: ApiHeader;
  data: T;
}

export function isApiEnvelope(body: unknown): body is ApiEnvelope<unknown> {
  if (typeof body !== 'object' || body === null || !('header' in body)) {
    return false;
  }
  const header = (body as { header: unknown }).header;
  return typeof header === 'object' && header !== null && 'error' in header && 'code' in header;
}
