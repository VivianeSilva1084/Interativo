import { describe, it, expect } from 'vitest';
import { isValidCpfCnpj } from '../src/lib/billing.js';

// Fixtures verified against the mod-11 algorithm independently, not just
// echoed back from the implementation under test.
describe('isValidCpfCnpj', () => {
  it('accepts a real, valid CPF', () => {
    expect(isValidCpfCnpj('52998224725')).toBe(true);
    expect(isValidCpfCnpj('11144477735')).toBe(true);
  });

  it('accepts any 14-digit string as a CNPJ (length-checked only, Asaas validates it)', () => {
    expect(isValidCpfCnpj('12345678901234')).toBe(true);
  });

  it('rejects an all-same-digit CPF (common invalid placeholder)', () => {
    expect(isValidCpfCnpj('11111111111')).toBe(false);
    expect(isValidCpfCnpj('00000000000')).toBe(false);
  });

  it('rejects a CPF with a wrong check digit', () => {
    expect(isValidCpfCnpj('12345678901')).toBe(false);
  });

  it('rejects strings that are neither 11 nor 14 digits', () => {
    expect(isValidCpfCnpj('123')).toBe(false);
    expect(isValidCpfCnpj('123456789012')).toBe(false);
    expect(isValidCpfCnpj('')).toBe(false);
  });
});
