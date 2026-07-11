import { describe, it, expect } from 'vitest';
import { shouldTreatBalanceFetchAsNonBlocking } from '../modules/urlAuth.js';

describe('shouldTreatBalanceFetchAsNonBlocking', () => {
  it('treats auth failures as non-blocking', () => {
    expect(shouldTreatBalanceFetchAsNonBlocking(401)).toBe(true);
    expect(shouldTreatBalanceFetchAsNonBlocking(403)).toBe(true);
    expect(shouldTreatBalanceFetchAsNonBlocking('HTTP 401')).toBe(true);
  });

  it('keeps server and network failures blocking', () => {
    expect(shouldTreatBalanceFetchAsNonBlocking(500)).toBe(false);
    expect(shouldTreatBalanceFetchAsNonBlocking('timeout')).toBe(false);
  });
});
