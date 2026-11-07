/**
 * Silent stand-in for `electron-log` in tests. Calls are recorded so a test can
 * assert on what was (or was not) logged.
 *
 * @module test-utils/logMock
 */
import { vi } from 'vitest';

const log = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

export default log;
