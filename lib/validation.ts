import { z } from 'zod';
import {
  LANGUAGES,
  MEMBERSHIP_TYPES,
  PLATFORMS,
  PLAYSTYLE_TAGS,
  REGIONS,
} from './taxonomy';

// Request schemas (see specs/api.md "Validation rules"). Taxonomy membership is
// enforced at parse time via z.enum over the taxonomy constants. Callers dedupe
// tags/platforms in the service before persisting.

// Discord URL: optional; if present, https + Discord host only, ≤ 200 chars.
const discordUrl = z
  .string()
  .trim()
  .max(200)
  .regex(/^https:\/\/(discord\.gg|discord\.com)\/.+$/, 'discordUrl must be a Discord URL')
  .nullable();

const contacts = z.object({ discordUrl });

export const searchClansRequest = z
  .object({
    name: z.string().max(64).nullish(),
    tags: z.array(z.enum(PLAYSTYLE_TAGS)).default([]),
    languages: z.array(z.enum(LANGUAGES)).default([]),
    regions: z.array(z.enum(REGIONS)).default([]),
    platforms: z.array(z.enum(PLATFORMS)).default([]),
    membershipTypes: z.array(z.enum(MEMBERSHIP_TYPES)).default([]),
    minMembers: z.number().int().min(0).max(100).nullish(),
    maxMembers: z.number().int().min(0).max(100).nullish(),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(50),
  })
  .refine(
    (r) => r.minMembers == null || r.maxMembers == null || r.minMembers <= r.maxMembers,
    { message: 'minMembers must be <= maxMembers', path: ['minMembers'] },
  );

export const publishListingRequest = z.object({
  contacts,
  language: z.enum(LANGUAGES),
  region: z.enum(REGIONS),
  tags: z.array(z.enum(PLAYSTYLE_TAGS)).min(1).max(PLAYSTYLE_TAGS.length),
  platforms: z.array(z.enum(PLATFORMS)).min(1).max(PLATFORMS.length),
});

export const editListingRequest = publishListingRequest.extend({
  version: z.number().int().min(1),
});

export type SearchClansRequest = z.infer<typeof searchClansRequest>;
export type PublishListingRequest = z.infer<typeof publishListingRequest>;
export type EditListingRequest = z.infer<typeof editListingRequest>;

import { AppError } from './errors';

// Parse a request body against a schema, converting failures into a 400 AppError
// with a readable message. Route handlers call this instead of schema.parse.
export function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new AppError('INVALID_REQUEST', detail);
  }
  return result.data;
}
