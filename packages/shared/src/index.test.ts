import { describe, expect, it } from 'vitest';

import { SHARED_PACKAGE_NAME } from './index.ts';

describe('shared package', () => {
  it('exposes its package name (workspace wiring smoke test)', () => {
    expect(SHARED_PACKAGE_NAME).toBe('eviction-notice/shared');
  });
});
