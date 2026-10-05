import { z } from 'zod';

export const addressSchema = z.object({
  label: z.string().min(1).max(30).default('home'),
  name: z.string().min(1).max(120),
  line1: z.string().min(1).max(200),
  line2: z.string().max(200).optional(),
  city: z.string().min(1).max(100),
  state: z.string().min(1).max(100),
  postalCode: z.string().regex(/^[A-Za-z0-9 -]{3,12}$/),
  country: z.string().length(2).transform((c) => c.toUpperCase()),
  phone: z.string().regex(/^\+?[0-9 -]{7,20}$/).optional(),
  isDefault: z.boolean().default(false),
});

export const profilePatchSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    phone: z.string().regex(/^\+?[0-9 -]{7,20}$/).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'nothing to update' });
