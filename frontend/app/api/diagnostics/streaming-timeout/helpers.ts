const ALLOWED_DIAGNOSTIC_HOSTS = new Set(['127.0.0.1', '127.0.0.1:3000', 'localhost', 'localhost:3000', 'forestgeo-development.azurewebsites.net']);

export function normalizeStreamingDiagnosticHost(host: string | null): string {
  return (host ?? '').trim().toLowerCase();
}

export function isAllowedStreamingDiagnosticHost(host: string | null): boolean {
  return ALLOWED_DIAGNOSTIC_HOSTS.has(normalizeStreamingDiagnosticHost(host));
}
