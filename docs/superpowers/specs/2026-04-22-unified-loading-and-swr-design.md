# Unified Loading UX & Stale-While-Revalidate — Design

Date: 2026-04-22
Branch: `feat/editing-feedback` (this spec; implementation branch TBD)
Status: Approved

## Overview

Today the app has two disconnected ways of saying "data is loading":

1. A global body-level overlay (`app/contexts/loadingprovider.tsx`) that
   blocks interaction. Fires only on mutations (deletes, census creation,
   uploads). 750ms minimum display.
2. MUI DataGrid's built-in spinner, driven by a local `loading` boolean
   in `components/datagrids/isolateddatagridcommons.tsx:113` and
   `components/datagrids/measurementscommons.tsx`. Set only when a user
   clicks refresh — not on initial mount, pagination, filter change, sort
   change, or background refetch.

The consequence: on grids the user most often cares about (View Data,
Measurements Summary, Quadrats, Attributes, Taxonomies, Errors), rows
simply appear when ready. Users can't tell whether the view is loading,
empty, or broken. The dashboard, by contrast, has skeleton placeholders
(`components/dashboard/metriccard.tsx`) and looks "right" — but uses a
different mechanism again, so there is no shared primitive or convention.

This design unifies loading UX across every fetching surface in the app
and, in the same cut, adopts SWR so that cached data is shown instantly
on revisit and a subtle indicator communicates background revalidation.
That combination — indicator unification plus stale-while-revalidate —
is the core delivery.

## Goals

1. A single visual language for "this surface is loading data" that is
   used by grids, dashboard cards, sidebar selectors, and form
   autocompletes.
2. Loading signals for *every* fetch path — initial mount, pagination,
   filter change, sort change, background refetch, post-mutation fresh
   fetch — not only on explicit refresh. Fetches that resolve in under
   150ms are deliberately invisible (anti-flicker debounce); anything
   longer produces a visible bar or skeleton.
3. In-session navigation between views feels instant. Users should
   rarely see the indicator after the first visit to each view.
4. Post-mutation views always show fresh data to the user who made the
   mutation, without a manual refresh.
5. The shared primitive and data hook are simple enough that new views
   get loading behavior for free.

## Non-goals (deferred)

- **Server components / SSR initial data.** Noted as a future pass ("C
  later"). Most pages under `app/(hub)/` are `'use client'` and lean on
  React contexts for site/plot/census; untangling that for server
  components is weeks of work disproportionate to the cold-start win.
- Optimistic updates.
- Infinite queries / virtual scroll.
- Offline / background sync.
- WebSocket-driven push invalidation.
- Retries on 4xx. SWR's default (retry on network / 5xx) is kept as-is.

## Architecture

```
  components/                   <- grids, cards, selectors, forms
     │  consume: { data, isLoading, isValidating, error, refetch }
     │  render: <LoadingBar/> when isValidating && data
     │          <ContentSkeleton kind=/> when !data && isLoading
     ▼
  lib/query/useForestQuery      <- thin SWR wrapper
     │   - normalizes key shape via queryKey()
     │   - normalizes return shape
     │   - routes errors through a shared fetcher (auth, JSON, status)
     ▼
  SWRConfig (app/layout.tsx)    <- global defaults
     │   revalidateOnFocus: true
     │   revalidateOnReconnect: true
     │   dedupingInterval: 2000
     │   errorRetryCount: 2 (network / 5xx only)
     ▼
  fetch()                       <- unchanged; /api/* endpoints unchanged
```

Three boundaries, each independently replaceable:

- Components know nothing about SWR. They take `{ data, isLoading,
  isValidating }` and render primitives.
- `useForestQuery` knows nothing about components. It takes a key and
  returns normalized state.
- The fetcher knows nothing about queries. It takes a URL, returns JSON,
  throws typed errors.

## Data layer: SWR + useForestQuery

New dependency: `swr@^2`. Added via `npm install swr` in `frontend/`.

### `lib/query/queryKey.ts`

One place serializes the site/plot/census + params context so two call
sites can never mis-key the same query. This is the single failure mode
that sinks SWR adoptions in practice.

```ts
export type QueryNamespace =
  | 'grid:measurements'
  | 'grid:summary'
  | 'grid:quadrats'
  | 'grid:attributes'
  | 'grid:taxonomies'
  | 'grid:errors'
  | 'dashboard:metrics'
  | 'dashboard:changelog'
  | 'select:species'
  | 'select:quadrats'
  // ...extended per rollout phase

export interface QueryScope {
  siteSchema?: string;
  plotID?: number;
  censusID?: number;
}

export function queryKey(
  namespace: QueryNamespace,
  scope: QueryScope,
  params?: Record<string, unknown>
): readonly [QueryNamespace, string, string | undefined] {
  const scopeKey = `${scope.siteSchema ?? ''}|${scope.plotID ?? ''}|${scope.censusID ?? ''}`;
  const paramKey = params ? stableStringify(params) : undefined;
  return [namespace, scopeKey, paramKey] as const;
}
```

`stableStringify` sorts object keys so `{a:1,b:2}` and `{b:2,a:1}`
produce the same key.

### `lib/query/fetcher.ts`

```ts
export class QueryError extends Error {
  constructor(
    public status: number,
    public body: unknown,
    message: string
  ) { super(message); }
}

export async function defaultFetcher(url: string): Promise<unknown> {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) {
    const body = await res.json().catch(() => undefined);
    throw new QueryError(res.status, body, `GET ${url} ${res.status}`);
  }
  return res.json();
}
```

### `lib/query/useForestQuery.ts`

```ts
export interface UseForestQueryResult<T> {
  data: T | undefined;
  isLoading: boolean;       // !data && no error yet
  isValidating: boolean;    // fetch in flight (with or without data)
  error: QueryError | undefined;
  refetch: () => Promise<T | undefined>;
}

export function useForestQuery<T>(
  key: ReturnType<typeof queryKey> | null,   // null disables the query
  url: string | null,
  opts?: SWRConfiguration<T>
): UseForestQueryResult<T>;
```

The `null` key / url pattern is how callers express "not ready yet"
(e.g., awaiting selected census). SWR treats `null` as "skip" — no fetch
fires, no revalidation fires, state is `{ data: undefined, isLoading:
false, isValidating: false }`.

### Mutation invalidation: `lib/query/mutateKey.ts`

```ts
export async function mutateKey(
  prefix: QueryNamespace,
  opts?: { revalidate?: boolean; scope?: QueryScope }
): Promise<void>;
```

Calls SWR's `mutate()` with a matcher that matches any key whose first
element equals `prefix` and — if `scope` is provided — whose scope key
matches. `{ revalidate: true }` (default) forces a fresh fetch.

**What the user sees after a mutation.** Because the cache still holds
the pre-mutation rows, the affected view renders those stale rows plus
the `<LoadingBar/>` (the `a1` bar treatment) until revalidation
resolves and the new rows swap in. It is *not* the `b1` skeleton
treatment — that would require clearing the cache, which would produce
a jarring empty-state flicker. This "stale rows + bar, then fresh rows"
sequence is acceptable: the bar is clearly visible, the user's
mutation action has already provided confirmation, and the final state
arrives quickly. Handlers that want stronger "your deletion is gone
right now" feedback can pass the mutation response through to
`mutate(key, newData)` — that is optimistic-update territory and out
of scope for this spec.

## Shared loading primitives

Two components, both typed, both unit-tested. Live under
`components/loading/`.

### `<LoadingBar/>`

A 2px indeterminate linear progress bar, absolutely positioned to the
top edge of its containing relatively-positioned parent. Uses MUI Joy's
`<LinearProgress variant="soft"/>`. Props:

```ts
interface LoadingBarProps {
  active: boolean;      // when false, renders null (not a faded bar)
  label?: string;       // sr-only; default "Refreshing data"
}
```

Key behavior:
- Fades in after 150ms (prevents flicker on sub-150ms revalidations).
- Fades out when `active` goes false; no minimum display (unlike the
  global overlay's 750ms).
- Wrapped in an `aria-live="polite"` region with `role="status"` so
  screen readers announce start/end of revalidation, once.

### `<ContentSkeleton kind=/>`

A router that selects the right skeleton shape for the surface:

```ts
type SkeletonKind =
  | 'grid-rows'        // skeleton rows inside a DataGrid
  | 'dashboard-card'   // matches MetricCardSkeleton / ProgressCardSkeleton shape
  | 'autocomplete'     // a disabled <Input> with a pulsing placeholder
  | 'form-row';        // generic single-row skeleton

interface ContentSkeletonProps {
  kind: SkeletonKind;
  count?: number;      // e.g., rows to render for grid-rows; default 8
}
```

Existing skeletons in `components/dashboard/*Skeleton.tsx` are
refactored into this component so there's exactly one place to tune
look-and-feel. The dashboard cards keep their shape exactly as today —
no visual regression on dashboard.

### Component integration pattern

```tsx
function ViewFullTableGrid() {
  const { siteSchema } = useSiteContext();
  const { plotID } = usePlotContext();
  const { censusID } = useCensusContext();
  const scope = { siteSchema, plotID, censusID };

  const { data, isLoading, isValidating } = useForestQuery<RowsResponse>(
    queryKey('grid:measurements', scope, { page, filter, sort }),
    buildURL('/api/view-full-table', scope, { page, filter, sort })
  );

  return (
    <Box sx={{ position: 'relative' }}>
      <LoadingBar active={isValidating && !!data} />
      {isLoading && !data
        ? <ContentSkeleton kind="grid-rows" count={pageSize} />
        : <DataGrid rows={data?.rows ?? []} /* loading={false} — handled by bar/skeleton */ />}
    </Box>
  );
}
```

Rule of thumb: **skeleton when we have nothing to show; bar when we
have something but are refreshing.** Never both at once.

## Mutation → fresh-fetch carve-out

Every mutation handler that currently calls
`useLoading().setLoadingState(true)` keeps doing so for the *destructive
block* (see "Global overlay narrowing" below), and additionally calls
`mutateKey(prefix, { revalidate: true, scope })` on success. The
affected views then show the stale-rows + `<LoadingBar/>` treatment
(see "What the user sees after a mutation" above) until revalidation
resolves.

Concrete touch points (non-exhaustive):

| Handler | Existing path | Invalidate prefix |
|---|---|---|
| Delete measurement | `measurementscommons.tsx` handler | `grid:measurements`, `grid:summary`, `dashboard:metrics` |
| Reingest failed rows | `app/api/reingest/[...]` caller | `grid:errors`, `grid:measurements`, `dashboard:metrics` |
| Save edit plan | `app/api/revisionupload/apply` caller | `grid:measurements`, `grid:errors`, `dashboard:metrics` |
| Delete quadrat / attribute | respective handlers | corresponding `grid:*` + `dashboard:metrics` |
| Census creation | `useLoading()` caller | all `grid:*`, `dashboard:*` |

A shared helper `invalidateAfter(mutation: MutationKind, scope)`
encapsulates the prefix set per mutation kind, so call sites don't
hand-list prefixes and drift.

## Prefetching on hover/focus

On the primary nav links (sidebar and any in-app link that routes to a
fetching view), a hover and focus handler calls `preload(key, fetcher)`
using the same key the target page will use on mount. The preload is
debounced (150ms hover intent) and deduped by SWR. This kills the
cold-to-warm transition on normal in-session navigation: by the time
the user clicks, data is already in the cache and the page renders
without indicator.

Implementation is a small wrapper `<PrefetchLink/>` around Next.js
`<Link/>` that takes `{ href, prefetchKey, prefetchURL }`. Pages that
aren't worth prefetching (e.g., destructive admin routes) keep using
plain `<Link/>`.

Cold-start on true first-visit-of-session is unchanged by this — the
`b1` skeleton treatment covers it. Optimizing that further is the
deferred "C" (server components).

## Global overlay narrowing

`GlobalLoadingProvider` in `app/contexts/loadingprovider.tsx` keeps its
API (`useLoading()`, `setLoadingState`, `isLoading`), but the
*contract* changes: it is now only for **destructive/blocking mutations
that should prevent all UI interaction** — delete, bulk upload,
long-running reingest, census creation. Any read path that currently
calls `setLoadingState(true)` is removed and replaced with the
appropriate SWR-driven primitive.

The 750ms minimum-display is kept for blocking mutations (it prevents
overlay flicker for fast deletes), but is deliberately absent from
`<LoadingBar/>` — fast revalidations should be invisible.

## Rollout plan

Scope is large (all fetching surfaces). The implementation plan will
likely split into two sub-plans after this spec is approved:

### Phase 1 — Foundation + grids + dashboard

1. Install `swr`; add `SWRConfig` to `app/layout.tsx`.
2. Build `queryKey`, `defaultFetcher`, `useForestQuery`, `mutateKey`,
   `invalidateAfter`.
3. Build `<LoadingBar/>` and `<ContentSkeleton/>` with unit tests.
4. Migrate `IsolatedDataGridCommons` and `MeasurementsCommons` to
   `useForestQuery`. Remove the internal 30s `CachedPageCache`.
5. Wire mutation handlers in grid files to `invalidateAfter`.
6. Migrate dashboard cards to `useForestQuery` + the shared primitive;
   delete the now-dead `MetricCardSkeleton` / `ProgressCardSkeleton`
   files.
7. Add `<PrefetchLink/>` and convert sidebar + top-nav links.

### Phase 2 — Selectors, autocompletes, forms

1. Migrate sidebar site/plot/census selects (currently no loading UI)
   to `useForestQuery` + `autocomplete` skeleton.
2. Migrate form autocompletes (`loadSelectableOptions` call sites).
3. Migrate remaining modal forms (edit plan preview, bulk upload
   preview).

Phase 1 delivers the user's stated pain point. Phase 2 is the
consistency / long-tail pass.

## Accessibility

- `<LoadingBar/>` lives in an `aria-live="polite"` region with
  `role="status"` and a visually-hidden label (default "Refreshing
  data"). Announces once per revalidation start.
- `<ContentSkeleton/>` sets `aria-busy="true"` on its container and
  `aria-hidden="true"` on the visual placeholder rows, so screen
  readers hear "loading" rather than empty grid semantics.
- Reduced-motion: respect `prefers-reduced-motion` by replacing the
  indeterminate stripe animation with a static filled bar, and the
  skeleton pulse with a static background.

## Testing strategy

- **Unit (Vitest):** `queryKey` stable-stringify; `<LoadingBar/>` 150ms
  debounce; `<ContentSkeleton/>` kind routing; `useForestQuery` return
  shape under SWR mock; `invalidateAfter` prefix fan-out per mutation
  kind.
- **Component (Cypress):** each migrated grid renders `b1` skeletons on
  mount with no cache; renders `a1` bar + cached rows on re-mount; bar
  disappears within one animation frame of fetch resolve;
  post-mutation (delete) shows stale rows + bar, then fresh rows when
  revalidation resolves.
- **Integration (existing Vitest integration harness):** server-side
  contracts unchanged; no new integration tests required for this spec.

Regression gates: existing `isolateddatagridcommons.test.tsx` and
`measurementscommons.test.tsx` must pass after migration (with
updates where they reference the old `loading`/`refresh` props).

## Success criteria

1. On every grid page, pagination, filter change, and sort change
   produces a visible loading signal (bar or skeleton) for fetches
   that take longer than 150ms. Fetches that resolve in under 150ms
   produce no signal by design.
2. Re-navigating to a previously-visited grid in the same session
   shows cached rows within 50ms (no skeleton) and a top bar that
   disappears when revalidation resolves.
3. After any mutation (delete / reingest / save), the affected grid
   and dashboard cards re-fetch and visibly indicate doing so —
   without a manual refresh click.
4. Zero reads call `setLoadingState(true)`. `GlobalLoadingProvider` is
   only invoked for destructive/blocking mutations.
5. No surface that fetches data is silent; every one uses either
   `<LoadingBar/>` or `<ContentSkeleton/>`.

## Open questions

- **Prefetch budget.** Aggressive prefetch on every sidebar hover
  could inflate read load on `/api/*`. Propose: debounce 150ms, and
  revisit quantitatively after Phase 1 ships.
- **Shared SWR cache persistence.** SWR's default cache is in-memory
  per tab. A future enhancement could persist to `sessionStorage` so
  full reloads keep the warm-cache feel. Out of scope for this pass.
- **Scope helpers elsewhere.** `queryKey` takes a `QueryScope`. Several
  call sites currently pull site/plot/census from separate contexts.
  A `useScope()` composing hook is sensible but not required for this
  spec; components can assemble scope inline in Phase 1.

## Later work (not this spec)

- **Server components / SSR initial data ("C later").** Convert
  `app/(hub)/**` page shells to server components that fetch the first
  page of data on the server, stream initial HTML, and seed the SWR
  cache via `fallbackData`. Biggest cold-start win; biggest refactor.
  Revisit after Phase 1 ships and metrics are available.
- **Optimistic updates** for single-row edits.
- **`sessionStorage`-backed SWR cache** for cross-reload persistence.
