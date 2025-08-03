import { getAppInsights } from '@/applicationinsights';

export async function fetchWithTelemetry(input: RequestInfo, init?: RequestInit) {
  const ai = getAppInsights();

  // you can tag telemetry manually before/after
  try {
    const response = await fetch(input, init);
    // Optionally record success/failure or augment with additional properties
    ai?.trackDependencyData({
      target: typeof input === 'string' ? input : (input as Request).url,
      name: 'custom-fetch',
      data: typeof input === 'string' ? input : (input as Request).url,
      duration: 0, // you could measure timing here manually if needed
      success: response.ok,
      time: new Date(),
      type: 'Fetch'
    } as any); // typing shim if needed
    return response;
  } catch (err) {
    ai?.trackException({ exception: err as Error });
    throw err;
  }
}
