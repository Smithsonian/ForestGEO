import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const baseline = Number(readFileSync(new URL('../.any-baseline', import.meta.url), 'utf8').trim());
const cmd = `grep -rnE ':[[:space:]]*any\\b|as any|<any>' app config components lib --include='*.ts' --include='*.tsx' | wc -l`;
const count = Number(
  execSync(cmd, { cwd: new URL('..', import.meta.url), shell: '/bin/bash' })
    .toString()
    .trim()
);
console.log(`any: ${count} (baseline ${baseline})`);
process.exit(count > baseline ? 1 : 0);
