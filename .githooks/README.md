# Git Hooks

This directory contains shared Git hooks for the ForestGEO project.

## Pre-Push Hook

The `pre-push` hook automatically runs tests before allowing pushes to protected branches (`main` and `forestgeo-app-development`).

### Features

- Runs all frontend tests before pushing to `main` or `forestgeo-app-development` branches
- Aborts the push if any tests fail
- Preserves Git LFS functionality
- Only runs for protected branches (other branches push normally)

### Installation

#### Option 1: One-time setup (Recommended)

Configure Git to use this hooks directory:

```bash
git config core.hooksPath .githooks
```

This command makes Git use the `.githooks` directory instead of `.git/hooks` for all hooks.

#### Option 2: Manual installation

Copy the hook to your local `.git/hooks` directory:

```bash
cp .githooks/pre-push .git/hooks/pre-push
chmod +x .git/hooks/pre-push
```

Note: This needs to be done by each developer and repeated if the hook is updated.

### How It Works

1. When you push to `main` or `forestgeo-app-development`, the hook detects the branch name
2. It runs `npm test` in the `frontend` directory
3. If tests fail, the push is aborted with an error message
4. If tests pass, the push continues normally

### Bypassing the Hook

In rare cases where you need to bypass the hook (not recommended):

```bash
git push --no-verify
```

**Warning:** Only use this if absolutely necessary and you understand the implications.

### Troubleshooting

**Hook not running:**
- Verify the hook is executable: `ls -l .githooks/pre-push` (should show `-rwxr-xr-x`)
- Check your Git hooks path: `git config core.hooksPath`

**Tests failing:**
- Run tests locally first: `cd frontend && npm test`
- Fix any failing tests before attempting to push
- Ensure all dependencies are installed: `cd frontend && npm install`
