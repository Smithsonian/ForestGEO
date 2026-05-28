import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const baseline = Number(readFileSync(new URL('../.any-baseline', import.meta.url), 'utf8').trim());
// Production code only: test mocks legitimately use `any` (mock signatures, response casts)
// and counting them creates a perverse incentive against adding tests. The gate's intent
// (per CLAUDE.md "no new any") is to prevent PRODUCTION drift.
const cmd = `grep -rnE ':[[:space:]]*any\\b|as any|<any>' app config components lib --include='*.ts' --include='*.tsx' --exclude='*.test.ts' --exclude='*.test.tsx' | wc -l`;
const count = Number(
  execSync(cmd, { cwd: new URL('..', import.meta.url), shell: '/bin/bash' })
    .toString()
    .trim()
);
console.log(`any: ${count} (baseline ${baseline})`);
process.exit(count > baseline ? 1 : 0);
