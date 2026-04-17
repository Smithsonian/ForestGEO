'use client';

/**
 * Thin React wrapper around the module-level ValidationRunner singleton.
 *
 * Components that need to *start* a validation call `startValidation()`.
 * Components that need to *display* status read from the Zustand store directly
 * (via useBackgroundValidationState).
 *
 * The actual execution lives in `@/config/validation-runner.ts` and survives
 * component unmounts, route changes, and re-renders.
 */

import { ValidationRunner, type ValidationRunParams } from '@/config/validation-runner';

export function useBackgroundValidation() {
  return {
    startValidation: (params: ValidationRunParams) => ValidationRunner.start(params),
    resumeValidation: (params: ValidationRunParams) => ValidationRunner.resume(params),
    isRunning: () => ValidationRunner.isRunning()
  };
}
