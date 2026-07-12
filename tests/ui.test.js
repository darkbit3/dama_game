import { describe, it, expect } from 'vitest';
import { getBetButtonDisabledState } from '../modules/ui.js';

describe('getBetButtonDisabledState', () => {
  it('disables buttons whose bet exceeds the current balance', () => {
    expect(getBetButtonDisabledState(100, 50)).toBe(true);
    expect(getBetButtonDisabledState(50, 100)).toBe(false);
  });
});
