// cypress/mocks/nextNavMock.js

const fakeRouter = {
  push: () => {},
  replace: () => {},
  back: () => {},
  forward: () => {},
  prefetch: () => Promise.resolve(),
  refresh: () => {}
};

// stub out the hook
export function useRouter() {
  return fakeRouter;
}

// if your code ever calls other navigation hooks, stub them too:
export function useSearchParams() {
  return new URLSearchParams();
}

export function usePathname() {
  return '/';
}

export function useParams() {
  return {};
}
