import { describe, expect, it } from 'vitest';

// @cypress/webpack-dev-server's findPagesDir() falls back to the PROJECT ROOT when a
// project has no pages/ or src/pages/ (this app is app-router only). next-swc-loader
// then computes `isPageFile = filename.startsWith(pagesDir)`, so every file under the
// repo -- node_modules included -- is compiled as a Next page and rejected for using
// `export * from '...'`, which MUI's esm barrels do. Next itself never sets pagesDir to
// the project root (find-pages-dir returns a real subdirectory or undefined), so
// `pagesDir === dir` identifies the Cypress-only value exactly and the fix is inert in
// dev and build.

const PROJECT_ROOT = '/repo/frontend';
const REAL_PAGES_DIR = '/repo/frontend/pages';
const SWC_LOADER = '/repo/frontend/node_modules/next/dist/build/webpack/loaders/next-swc-loader.js';
const OTHER_LOADER = '/repo/frontend/node_modules/css-loader/dist/cjs.js';

type LoaderUse = { loader: string; options?: Record<string, unknown> };
type Rule = { use?: LoaderUse[]; oneOf?: Rule[]; rules?: Rule[] };
type FakeConfig = {
  resolve: { fallback: Record<string, unknown>; alias: Record<string, string> };
  module: { rules: Rule[] };
};

function swcRule(pagesDir: string | undefined): Rule {
  return { use: [{ loader: SWC_LOADER, options: { pagesDir, appDir: undefined } }] };
}

// Mirrors the shape Next produces: swc loaders live inside `oneOf`, and the walk must
// also descend into nested `rules` arrays.
function makeConfig(pagesDir: string | undefined): FakeConfig {
  return {
    resolve: { fallback: {}, alias: {} },
    module: {
      rules: [{ oneOf: [swcRule(pagesDir), swcRule(pagesDir)] }, { rules: [swcRule(pagesDir)] }, { use: [{ loader: OTHER_LOADER, options: { pagesDir } }] }]
    }
  };
}

async function applyWebpackHook(config: FakeConfig, dir: string): Promise<FakeConfig> {
  const mod = (await import('./next.config.js')) as unknown as {
    default: { webpack: (c: FakeConfig, o: { isServer: boolean; dev: boolean; dir: string }) => FakeConfig };
  };
  return mod.default.webpack(config, { isServer: false, dev: true, dir });
}

function collectLoaderPagesDirs(config: FakeConfig, loaderPath: string): unknown[] {
  const found: unknown[] = [];
  const visit = (rules: Rule[] | undefined) => {
    for (const rule of rules ?? []) {
      for (const use of rule.use ?? []) {
        if (use.loader === loaderPath) found.push(use.options?.pagesDir);
      }
      visit(rule.oneOf);
      visit(rule.rules);
    }
  };
  visit(config.module.rules);
  return found;
}

describe('next.config.js webpack hook — Cypress pagesDir neutralisation', () => {
  it('clears pagesDir on every next-swc-loader entry when it equals the project root', async () => {
    const result = await applyWebpackHook(makeConfig(PROJECT_ROOT), PROJECT_ROOT);
    const pagesDirs = collectLoaderPagesDirs(result, SWC_LOADER);

    expect(pagesDirs).toHaveLength(3);
    expect(pagesDirs.every(value => value === undefined)).toBe(true);
  });

  it('preserves a real pagesDir subdirectory so real builds are unaffected', async () => {
    const result = await applyWebpackHook(makeConfig(REAL_PAGES_DIR), PROJECT_ROOT);

    expect(collectLoaderPagesDirs(result, SWC_LOADER)).toEqual([REAL_PAGES_DIR, REAL_PAGES_DIR, REAL_PAGES_DIR]);
  });

  it('leaves non-swc loaders untouched', async () => {
    const result = await applyWebpackHook(makeConfig(PROJECT_ROOT), PROJECT_ROOT);

    expect(collectLoaderPagesDirs(result, OTHER_LOADER)).toEqual([PROJECT_ROOT]);
  });

  it('no longer injects the inert @mui esm aliases', async () => {
    const result = await applyWebpackHook(makeConfig(PROJECT_ROOT), PROJECT_ROOT);

    expect(result.resolve.alias).not.toHaveProperty('@mui/material/esm');
    expect(result.resolve.alias).not.toHaveProperty('@mui/utils/esm');
  });
});
