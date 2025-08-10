// setup.ts
import { afterEach, expect } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest'; // <-- auto-extends expect for Vitest
import '@/testing/db-mocks';
import '@/testing/bg-mocks';
import '@/testing/platform-mocks';
import '@/testing/auth-mocks';
import * as matchers from '@testing-library/jest-dom/matchers';

afterEach(() => {
  cleanup();
});

expect.extend(matchers);
