export class QueryError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    message: string
  ) {
    super(message);
    this.name = 'QueryError';
  }
}

export async function defaultFetcher<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) {
    const body = await res.json().catch(() => undefined);
    throw new QueryError(res.status, body, `GET ${url} ${res.status}`);
  }
  return (await res.json()) as T;
}
