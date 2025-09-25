export async function loadRoute<T extends Record<string, any>>(routePath: string): Promise<T> {
  return (await import(routePath)) as unknown as T;
}
export type NextAuthParams = { nextauth?: string[] };
export type RouteHandlerWithCtx = (req: Request, ctx?: { params: NextAuthParams }) => Promise<Response>;
export type RouteHandler = RouteHandlerWithCtx;
export type RouteHandlers = { GET: RouteHandlerWithCtx; POST: RouteHandlerWithCtx };
