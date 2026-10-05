import { describe, expect, it } from 'vitest';
import { buildObjectKey, canRead, sanitizeFilename, validateUpload } from '../src/keys.js';

describe('media keys', () => {
  it('sanitizes filenames and strips paths', () => {
    expect(sanitizeFilename('../../etc/pass wd.png')).toBe('pass-wd.png');
    expect(sanitizeFilename('...')).toBe('file');
  });
  it('builds per-user and product keys with the canonical extension', () => {
    expect(buildObjectKey('review', 'u1', 'id1', 'My Photo.JPEG', 'image/jpeg')).toBe('users/u1/review/id1-My-Photo.jpg');
    expect(buildObjectKey('product', 'u1', 'id1', 'shoe.png', 'image/png')).toBe('products/id1-shoe.png');
  });
  it('validates type and size', () => {
    expect(validateUpload('image/png', 100, 1000)).toBeNull();
    expect(validateUpload('application/pdf', 100, 1000)).toMatch(/not allowed/);
    expect(validateUpload('image/png', 1001, 1000)).toMatch(/between/);
  });
  it('enforces read access', () => {
    expect(canRead('users/u1/review/x.jpg', 'u1', false)).toBe(true);
    expect(canRead('users/u2/review/x.jpg', 'u1', false)).toBe(false);
    expect(canRead('products/x.jpg', 'u1', false)).toBe(true);
    expect(canRead('users/u2/../u1/x', 'u2', false)).toBe(false);
    expect(canRead('users/u2/x.jpg', 'admin', true)).toBe(true);
  });
});
