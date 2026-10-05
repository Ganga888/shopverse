import { createHash } from 'node:crypto';
import type { ProductChanged } from '@shopverse/common';

export interface ProductRow {
  id: string;
  sku: string;
  name: string;
  description: string;
  category: string;
  price_cents: string | number;
  currency: string;
  image_url: string | null;
  active: boolean;
  version: number;
  created_at: Date;
  updated_at: Date;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  description: string;
  category: string;
  priceCents: number;
  currency: string;
  imageUrl: string | null;
  active: boolean;
  version: number;
  updatedAt: string;
}

export function toProduct(r: ProductRow): Product {
  return {
    id: r.id,
    sku: r.sku,
    name: r.name,
    description: r.description,
    category: r.category,
    priceCents: Number(r.price_cents),
    currency: r.currency,
    imageUrl: r.image_url,
    active: r.active,
    version: r.version,
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

export function toEventData(p: Product): ProductChanged {
  return {
    productId: p.id,
    sku: p.sku,
    name: p.name,
    description: p.description,
    category: p.category,
    priceCents: p.priceCents,
    currency: p.currency,
    imageUrl: p.imageUrl,
    active: p.active,
    version: p.version,
  };
}

export const CACHE = {
  productKey: (id: string) => `catalog:product:${id}`,
  generationKey: 'catalog:list:gen',
  /** List keys embed a generation counter: bumping it invalidates every cached page at once. */
  listKey: (generation: string | number, query: Record<string, unknown>) => {
    const canonical = JSON.stringify(Object.keys(query).sort().map((k) => [k, query[k]]));
    return `catalog:list:${generation}:${createHash('sha1').update(canonical).digest('hex')}`;
  },
  productTtlSec: 300,
  listTtlSec: 60,
};
