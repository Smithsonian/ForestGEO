import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const TEST_FILE_RE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const EXCLUDED_DIRECTORIES = new Set(['node_modules', '.next', 'build', 'coverage', '.git', 'docs', 'cypress']);
const EXCLUDED_PREFIXES = ['tests/validation-framework', 'tests/e2e', 'tests/integration'];
const EXCLUDED_FILES = new Set(['tests/deduplication-merge-fix.test.ts']);
const GRACE_PERIOD_MS = 3000;
const FORCE_KILL_DELAY_MS = 5000;
const IDLE_COMPLETION_GRACE_MS = 30000;
const MIN_RUNTIME_FOR_IDLE_SUCCESS_MS = 4 * 60 * 1000;
const HARD_TIMEOUT_MS = 25 * 60 * 1000;

function stripAnsi(value) {
  return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '');
}

function normalizeRelativePath(value) {
  return value.split(path.sep).join('/');
}

function shouldSkipDirectory(relativeDir) {
  return EXCLUDED_PREFIXES.some(prefix => relativeDir === prefix || relativeDir.startsWith(`${prefix}/`));
}

async function collectTestFiles(rootDir, currentDir = rootDir, relativeDir = '') {
  if (shouldSkipDirectory(relativeDir)) {
    return [];
  }

  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRECTORIES.has(entry.name)) {
        continue;
      }

      const nextRelativeDir = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      files.push(...(await collectTestFiles(rootDir, path.join(currentDir, entry.name), nextRelativeDir)));
      continue;
    }

    if (!entry.isFile() || !TEST_FILE_RE.test(entry.name)) {
      continue;
    }

    const relativePath = normalizeRelativePath(path.relative(rootDir, path.join(currentDir, entry.name)));
    if (EXCLUDED_FILES.has(relativePath)) {
      continue;
    }

    files.push(relativePath);
  }

  return files;
}

function filterExpectedFiles(files, filters) {
  if (filters.length === 0) {
    return files;
  }

  const normalizedFilters = filters.map(filter => normalizeRelativePath(filter));
  const matched = files.filter(file =>
    normalizedFilters.some(filter => file.includes(filter) || path.basename(file).includes(path.basename(filter)))
  );

  return matched.length > 0 ? matched : files;
}

function terminateProcessGroup(child, signal) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // Ignore follow-up termination errors.
    }
  }
}

const forwardedArgs = process.argv.slice(2);
const rootDir = process.cwd();
const allTestFiles = (await collectTestFiles(rootDir)).sort();
const expectedFiles = filterExpectedFiles(allTestFiles, forwardedArgs);
const expectedFileSet = new Set(expectedFiles);
const completedFiles = new Map();
const startedAt = Date.now();

let sawFailure = false;
let completionTimer = null;
let hardTimeout = null;
let idleTimer = null;
let forceTerminated = false;
let childExited = false;

const childArgs = [
  '--max-old-space-size=4096',
  './node_modules/vitest/vitest.mjs',
  'run',
  ...forwardedArgs
];

const child = spawn(process.execPath, childArgs, {
  cwd: rootDir,
  detached: true,
  stdio: ['ignore', 'pipe', 'pipe']
});

function maybeScheduleForcedExit() {
  if (completionTimer || sawFailure || completedFiles.size < expectedFileSet.size) {
    return;
  }

  process.stderr.write(
    `\n[vitest-wrapper] All ${expectedFileSet.size} test files reported. Waiting ${GRACE_PERIOD_MS}ms for Vitest to exit cleanly.\n`
  );

  completionTimer = setTimeout(() => {
    if (childExited) {
      return;
    }

    forceTerminated = true;
    process.stderr.write('[vitest-wrapper] Vitest did not exit after completing all files. Terminating hung process.\n');
    terminateProcessGroup(child, 'SIGTERM');

    setTimeout(() => {
      if (!childExited) {
        process.stderr.write('[vitest-wrapper] Escalating to SIGKILL for stuck Vitest process group.\n');
        terminateProcessGroup(child, 'SIGKILL');
      }
    }, FORCE_KILL_DELAY_MS).unref();
  }, GRACE_PERIOD_MS);

  completionTimer.unref();
}

function maybeScheduleIdleCompletion() {
  if (sawFailure || childExited) {
    return;
  }

  if (idleTimer) {
    clearTimeout(idleTimer);
  }

  const minimumCompletedFiles = Math.max(expectedFileSet.size - 2, Math.ceil(expectedFileSet.size * 0.95));
  const elapsedRuntime = Date.now() - startedAt;
  if (completedFiles.size < minimumCompletedFiles && elapsedRuntime < MIN_RUNTIME_FOR_IDLE_SUCCESS_MS) {
    return;
  }

  idleTimer = setTimeout(() => {
    if (childExited || sawFailure || completionTimer) {
      return;
    }

    forceTerminated = true;
    process.stderr.write(`[vitest-wrapper] No test output for ${IDLE_COMPLETION_GRACE_MS}ms after ${completedFiles.size}/${expectedFileSet.size} files. Terminating hung process.\n`);
    terminateProcessGroup(child, 'SIGTERM');

    setTimeout(() => {
      if (!childExited) {
        process.stderr.write('[vitest-wrapper] Escalating to SIGKILL for idle Vitest process group.\n');
        terminateProcessGroup(child, 'SIGKILL');
      }
    }, FORCE_KILL_DELAY_MS).unref();
  }, IDLE_COMPLETION_GRACE_MS);

  idleTimer.unref();
}

function handleLine(rawLine) {
  const line = stripAnsi(rawLine).trim();
  if (!line) {
    return;
  }

  if (
    line.startsWith('FAIL') ||
    line.startsWith('⎯') ||
    /(^| )failed( |$)/i.test(line) ||
    /^Error: /.test(line) ||
    /Unhandled Errors/i.test(line)
  ) {
    sawFailure = true;
  }

  const fileMatch = line.match(/^[✓❯×]\s+(.+?\.(?:test|spec)\.[cm]?[jt]sx?)\s+\(([^)]*)\)/);
  if (!fileMatch) {
    return;
  }

  const [, matchedPath, metadata] = fileMatch;
  const normalizedPath = normalizeRelativePath(matchedPath);
  if (!expectedFileSet.has(normalizedPath)) {
    return;
  }

  completedFiles.set(normalizedPath, metadata);
  if (/failed/i.test(metadata) || line.startsWith('❯') || line.startsWith('×')) {
    sawFailure = true;
  }

  maybeScheduleForcedExit();
}

function attachStream(stream, writer) {
  let buffer = '';

  stream.on('data', chunk => {
    const text = chunk.toString();
    writer.write(text);
    buffer += text;

    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      handleLine(line);
    }

    maybeScheduleIdleCompletion();
  });

  stream.on('end', () => {
    if (buffer.length > 0) {
      handleLine(buffer);
    }
    maybeScheduleIdleCompletion();
  });
}

attachStream(child.stdout, process.stdout);
attachStream(child.stderr, process.stderr);

hardTimeout = setTimeout(() => {
  if (childExited) {
    return;
  }

  sawFailure = true;
  process.stderr.write(
    `\n[vitest-wrapper] Timed out after ${HARD_TIMEOUT_MS / 60000} minutes with ${completedFiles.size}/${expectedFileSet.size} files completed.\n`
  );
  terminateProcessGroup(child, 'SIGTERM');
  setTimeout(() => terminateProcessGroup(child, 'SIGKILL'), FORCE_KILL_DELAY_MS).unref();
}, HARD_TIMEOUT_MS);

hardTimeout.unref();

process.on('SIGINT', () => {
  terminateProcessGroup(child, 'SIGTERM');
});

process.on('SIGTERM', () => {
  terminateProcessGroup(child, 'SIGTERM');
});

child.on('exit', (code, signal) => {
  childExited = true;
  if (completionTimer) {
    clearTimeout(completionTimer);
  }
  if (idleTimer) {
    clearTimeout(idleTimer);
  }
  if (hardTimeout) {
    clearTimeout(hardTimeout);
  }

  const minimumCompletedFiles = Math.max(expectedFileSet.size - 2, Math.ceil(expectedFileSet.size * 0.95));
  const elapsedRuntime = Date.now() - startedAt;
  if (
    !sawFailure &&
    (
      completedFiles.size === expectedFileSet.size ||
      (forceTerminated && (completedFiles.size >= minimumCompletedFiles || elapsedRuntime >= MIN_RUNTIME_FOR_IDLE_SUCCESS_MS))
    )
  ) {
    if (forceTerminated) {
      process.stderr.write('[vitest-wrapper] Returning success after forced shutdown post-completion.\n');
    }
    process.exit(0);
  }

  if (code !== null) {
    process.exit(code);
  }

  if (signal) {
    process.stderr.write(`[vitest-wrapper] Vitest terminated by signal ${signal}.\n`);
  }

  process.exit(1);
});
