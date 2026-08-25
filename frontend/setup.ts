// setup.ts
import { afterEach, expect } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest'; // <-- auto-extends expect for Vitest
import '@/tests/mocks/db-mocks';
import '@/tests/mocks/bg-mocks';
import '@/tests/mocks/platform-mocks';
import '@/tests/mocks/auth-mocks';
import * as matchers from '@testing-library/jest-dom/matchers';

afterEach(() => {
  cleanup();
});

expect.extend(matchers);
