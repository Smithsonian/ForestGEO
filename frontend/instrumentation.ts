/**
 * Next.js instrumentation hook. Runs once per process at startup, in BOTH the
 * Node and Edge runtimes. We only need to install provisioning hooks in Node,
 * and the Node-only work transitively imports mysql2 which has no Edge build —
 * so the dynamic import of the Node implementation must be gated by runtime
 * and live in a separate file that the Edge bundle never resolves.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./instrumentation-node');
  }
}
