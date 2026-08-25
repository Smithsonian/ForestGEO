import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const baseline = Number(readFileSync(new URL('../.cycle-baseline', import.meta.url), 'utf8').trim());
const frontendDir = new URL('..', import.meta.url);
let raw;
try {
  raw = execSync('npx madge --circular --extensions ts,tsx --ts-config tsconfig.json .', {
    cwd: frontendDir,
    stdio: 'pipe'
  }).toString();
} catch (err) {
  raw = err.stdout ? err.stdout.toString() : '';
}
const count = (raw.match(/^\s*\d+\)/gm) || []).length;
console.log(`cycles: ${count} (baseline ${baseline})`);
if (count > baseline) {
  console.error(raw);
  console.error(`FAIL: cycle count increased (${count} > ${baseline}). New cycles are not allowed.`);
  process.exit(1);
}
if (count < baseline) console.log(`Tip: count dropped — lower .cycle-baseline to ${count} to ratchet.`);
process.exit(0);
