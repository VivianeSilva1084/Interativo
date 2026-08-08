import { describe, it, expect } from 'vitest';
import { hashPin } from '../src/lib/pin-gate.js';
import { state } from '../src/lib/session-state.js';

// hashPin salts the PIN with state.authUserId (an inline FNV-1a hash, not
// Web Crypto) so the same 4-digit PIN hashes differently per family - a
// leaked parent_pin_hash from one family can't unlock another's parents area.
// Expected values below were computed independently (a second implementation
// of the same FNV-1a loop), not copied from the function under test.
describe('hashPin', () => {
  it('matches an independently-computed FNV-1a hash', async () => {
    state.authUserId = 'user-abc';
    expect(await hashPin('1234')).toBe('7216d099');
  });

  it('is deterministic for the same PIN + user', async () => {
    state.authUserId = 'user-abc';
    const a = await hashPin('1234');
    const b = await hashPin('1234');
    expect(a).toBe(b);
  });

  it('produces a different hash for a different PIN, same user', async () => {
    state.authUserId = 'user-abc';
    expect(await hashPin('4321')).not.toBe(await hashPin('1234'));
  });

  it('produces a different hash for the same PIN, different user (salted)', async () => {
    state.authUserId = 'user-abc';
    const forUserAbc = await hashPin('1234');
    state.authUserId = 'user-xyz';
    const forUserXyz = await hashPin('1234');
    expect(forUserAbc).not.toBe(forUserXyz);
  });
});
