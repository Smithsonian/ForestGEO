import { getApiErrorMessage, readResponsePayload } from '@/components/uploadsystemhelpers/uploadsessionconflicts';

export const SUBMIT_FAILURE_BODY_PREVIEW_LENGTH = 200;

export async function describeBulkcrudSubmitFailure(response: Response): Promise<string> {
  const payload = await readResponsePayload(response);
  const jsonError = typeof payload === 'object' ? getApiErrorMessage(payload) : null;
  if (jsonError) return jsonError;

  // Keep unstructured gateway/proxy responses bounded and accompanied by their HTTP status.
  const bodyText = payload === null ? '' : typeof payload === 'string' ? payload : (JSON.stringify(payload) ?? '');
  const preview = bodyText.trim().slice(0, SUBMIT_FAILURE_BODY_PREVIEW_LENGTH);
  const detail = preview ? `: ${preview}` : '';
  return `The rows could not be submitted (HTTP ${response.status})${detail}. No completion was recorded.`;
}
