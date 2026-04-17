import { describe, expect, it, vi } from 'vitest';
import { createEnhancedDispatch } from './contextreducers';

const { submitCookie } = vi.hoisted(() => ({
  submitCookie: vi.fn()
}));

vi.mock('@/app/actions/cookiemanager', () => ({
  submitCookie
}));

describe('createEnhancedDispatch', () => {
  it('clears the census cookie when the census selection is reset', async () => {
    const dispatch = vi.fn();
    const enhancedDispatch = createEnhancedDispatch(dispatch, 'census');

    await enhancedDispatch({ census: undefined });

    expect(submitCookie).toHaveBeenCalledWith('censusID', '');
    expect(dispatch).toHaveBeenCalledWith({ type: 'census', payload: { census: undefined } });
  });

  it('writes an empty census list cookie when the list is cleared', async () => {
    const dispatch = vi.fn();
    const enhancedDispatch = createEnhancedDispatch(dispatch, 'censusList');

    await enhancedDispatch({ censusList: undefined });

    expect(submitCookie).toHaveBeenCalledWith('censusList', '[]');
    expect(dispatch).toHaveBeenCalledWith({ type: 'censusList', payload: { censusList: undefined } });
  });
});
