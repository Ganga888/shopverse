import { describe, expect, it } from 'vitest';
import { hashPassword, newRefreshToken, passwordPolicyError, sha256, verifyPassword } from '../src/password.js';
import { loadSigningKeys } from '../src/keys.js';

describe('password hashing', () => {
  it('verifies the right password only', async () => {
    const h = await hashPassword('s3cretPass');
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('s3cretPass', h)).toBe(true);
    expect(await verifyPassword('wrong-pass1', h)).toBe(false);
    expect(await verifyPassword('s3cretPass', 'garbage')).toBe(false);
  });
  it('salts every hash', async () => {
    expect(await hashPassword('abc12345')).not.toBe(await hashPassword('abc12345'));
  });
  it('enforces the password policy', () => {
    expect(passwordPolicyError('short1')).not.toBeNull();
    expect(passwordPolicyError('lettersonly')).not.toBeNull();
    expect(passwordPolicyError('Passw0rdOK')).toBeNull();
  });
  it('generates unique refresh tokens', () => {
    expect(newRefreshToken()).not.toBe(newRefreshToken());
    expect(sha256('a')).toHaveLength(64);
  });
});

describe('signing keys', () => {
  it('generates an ephemeral RS256 JWK with kid outside production', async () => {
    const k = await loadSigningKeys(undefined, undefined, true);
    expect(k.jwk).toMatchObject({ kty: 'RSA', alg: 'RS256', use: 'sig', kid: k.kid });
  });
  it('refuses to start without keys in production', async () => {
    await expect(loadSigningKeys(undefined, undefined, false)).rejects.toThrow();
  });
});
