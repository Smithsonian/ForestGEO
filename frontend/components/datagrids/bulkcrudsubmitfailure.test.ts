import { describe, expect, it } from 'vitest';
import { HTTPResponses } from '@/config/macros';
import { describeBulkcrudSubmitFailure, SUBMIT_FAILURE_BODY_PREVIEW_LENGTH } from './bulkcrudsubmitfailure';

describe('describeBulkcrudSubmitFailure', () => {
  it('shows the JSON error the route returned', async () => {
    const response = new Response(JSON.stringify({ error: 'Select a census before submitting these rows.' }), { status: HTTPResponses.BAD_REQUEST });
    expect(await describeBulkcrudSubmitFailure(response)).toBe('Select a census before submitting these rows.');
  });

  it('shows the status and text of a non-JSON body (gateway or proxy page)', async () => {
    const message = await describeBulkcrudSubmitFailure(new Response('Service Unavailable', { status: HTTPResponses.SERVICE_UNAVAILABLE }));
    expect(message).toBe(`The rows could not be submitted (HTTP ${HTTPResponses.SERVICE_UNAVAILABLE}): Service Unavailable. No completion was recorded.`);
  });

  it('uses the shared responseMessage fallback when error is blank', async () => {
    const response = new Response(JSON.stringify({ error: '   ', responseMessage: 'Please try again.' }), { status: HTTPResponses.BAD_REQUEST });
    expect(await describeBulkcrudSubmitFailure(response)).toBe('Please try again.');
  });

  it('shows the status and body when the JSON has no usable error field', async () => {
    const body = JSON.stringify({ details: 'something else' });
    const message = await describeBulkcrudSubmitFailure(new Response(body, { status: HTTPResponses.INTERNAL_SERVER_ERROR }));
    expect(message).toContain(`HTTP ${HTTPResponses.INTERNAL_SERVER_ERROR}`);
    expect(message).toContain(body);
  });

  it('still names the status when the body is empty', async () => {
    const message = await describeBulkcrudSubmitFailure(new Response('', { status: HTTPResponses.INTERNAL_SERVER_ERROR }));
    expect(message).toBe(`The rows could not be submitted (HTTP ${HTTPResponses.INTERNAL_SERVER_ERROR}). No completion was recorded.`);
  });

  it('still names the status when the response body stream fails', async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.error(new TypeError('Connection terminated while reading response body'));
      }
    });
    const response = new Response(body, { status: HTTPResponses.SERVICE_UNAVAILABLE });

    await expect(describeBulkcrudSubmitFailure(response)).resolves.toBe(
      `The rows could not be submitted (HTTP ${HTTPResponses.SERVICE_UNAVAILABLE}). No completion was recorded.`
    );
  });

  it('cuts a long body to the preview length', async () => {
    const longBody = 'x'.repeat(SUBMIT_FAILURE_BODY_PREVIEW_LENGTH + 50);
    const message = await describeBulkcrudSubmitFailure(new Response(longBody, { status: HTTPResponses.SERVICE_UNAVAILABLE }));
    expect(message).toContain('x'.repeat(SUBMIT_FAILURE_BODY_PREVIEW_LENGTH));
    expect(message).not.toContain('x'.repeat(SUBMIT_FAILURE_BODY_PREVIEW_LENGTH + 1));
  });
});
