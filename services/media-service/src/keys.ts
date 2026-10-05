export const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
};
export const PURPOSES = ['product', 'avatar', 'review'] as const;
export type Purpose = (typeof PURPOSES)[number];

export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  const cleaned = base.normalize('NFKD').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+/, '').slice(0, 80);
  return cleaned || 'file';
}

/** Object key layout: products/<id>-<name> (admin, public via CDN) | users/<userId>/<purpose>/<id>-<name>. */
export function buildObjectKey(purpose: Purpose, userId: string, id: string, filename: string, contentType: string): string {
  const ext = ALLOWED_TYPES[contentType];
  const name = sanitizeFilename(filename).replace(/\.[A-Za-z0-9]+$/, '');
  const file = `${id}-${name}.${ext}`;
  return purpose === 'product' ? `products/${file}` : `users/${userId}/${purpose}/${file}`;
}

export function validateUpload(contentType: string, contentLength: number, maxBytes: number): string | null {
  if (!ALLOWED_TYPES[contentType]) return `content type ${contentType} not allowed`;
  if (contentLength <= 0 || contentLength > maxBytes) return `file must be between 1 byte and ${maxBytes} bytes`;
  return null;
}

/** Users may read their own objects and the public product images; admins may read anything. */
export function canRead(key: string, userId: string, isAdmin: boolean): boolean {
  if (key.includes('..')) return false;
  return isAdmin || key.startsWith('products/') || key.startsWith(`users/${userId}/`);
}
