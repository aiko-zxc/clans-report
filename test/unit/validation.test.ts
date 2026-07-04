import { describe, expect, it } from 'vitest';
import { AppError } from '@/lib/errors';
import {
  editListingRequest,
  parse,
  publishListingRequest,
  searchClansRequest,
} from '@/lib/validation';

const validPublish = {
  contacts: { discordUrl: 'https://discord.gg/abc123' },
  language: 'English',
  region: 'AMERICAS',
  tags: ['PvE', 'Raids'],
  platforms: ['PC'],
};

describe('parse()', () => {
  it('returns typed data on success', () => {
    const out = parse(publishListingRequest, validPublish);
    expect(out.language).toBe('English');
  });

  it('throws INVALID_REQUEST with a readable message on failure', () => {
    try {
      parse(publishListingRequest, { ...validPublish, language: 'Klingon' });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe('INVALID_REQUEST');
      expect((e as AppError).message).toContain('language');
    }
  });
});

describe('discordUrl', () => {
  const withUrl = (discordUrl: unknown) =>
    publishListingRequest.safeParse({ ...validPublish, contacts: { discordUrl } });

  it('accepts discord.gg and discord.com', () => {
    expect(withUrl('https://discord.gg/x').success).toBe(true);
    expect(withUrl('https://discord.com/invite/x').success).toBe(true);
  });

  it('accepts null (no link)', () => {
    expect(withUrl(null).success).toBe(true);
  });

  it('rejects non-Discord hosts and http', () => {
    expect(withUrl('https://evil.com/x').success).toBe(false);
    expect(withUrl('http://discord.gg/x').success).toBe(false);
  });

  it('rejects > 200 chars', () => {
    expect(withUrl('https://discord.gg/' + 'a'.repeat(200)).success).toBe(false);
  });

  it('trims surrounding whitespace before validating', () => {
    const r = withUrl('  https://discord.gg/x  ');
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.contacts.discordUrl).toBe('https://discord.gg/x');
  });
});

describe('publish tags / platforms', () => {
  it('rejects empty tags and empty platforms', () => {
    expect(publishListingRequest.safeParse({ ...validPublish, tags: [] }).success).toBe(false);
    expect(publishListingRequest.safeParse({ ...validPublish, platforms: [] }).success).toBe(false);
  });

  it('rejects unknown tag / platform values', () => {
    expect(publishListingRequest.safeParse({ ...validPublish, tags: ['Nope'] }).success).toBe(false);
    expect(publishListingRequest.safeParse({ ...validPublish, platforms: ['SWITCH'] }).success).toBe(false);
  });
});

describe('editListingRequest', () => {
  it('requires a positive integer version', () => {
    expect(editListingRequest.safeParse({ ...validPublish, version: 1 }).success).toBe(true);
    expect(editListingRequest.safeParse({ ...validPublish, version: 0 }).success).toBe(false);
    expect(editListingRequest.safeParse(validPublish).success).toBe(false);
  });
});

describe('searchClansRequest', () => {
  const base = { page: 1, pageSize: 8 };

  it('applies array defaults and requires page/pageSize', () => {
    const r = searchClansRequest.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.tags).toEqual([]);
    expect(searchClansRequest.safeParse({ page: 1 }).success).toBe(false);
  });

  it('caps pageSize at 50 and floors page at 1', () => {
    expect(searchClansRequest.safeParse({ ...base, pageSize: 51 }).success).toBe(false);
    expect(searchClansRequest.safeParse({ ...base, page: 0 }).success).toBe(false);
  });

  it('rejects minMembers > maxMembers, accepts equal', () => {
    expect(searchClansRequest.safeParse({ ...base, minMembers: 50, maxMembers: 20 }).success).toBe(false);
    expect(searchClansRequest.safeParse({ ...base, minMembers: 20, maxMembers: 20 }).success).toBe(true);
  });

  it('allows one bound without the other', () => {
    expect(searchClansRequest.safeParse({ ...base, minMembers: 20 }).success).toBe(true);
    expect(searchClansRequest.safeParse({ ...base, maxMembers: 20 }).success).toBe(true);
  });

  it('rejects member bounds outside 0..100', () => {
    expect(searchClansRequest.safeParse({ ...base, minMembers: -1 }).success).toBe(false);
    expect(searchClansRequest.safeParse({ ...base, maxMembers: 101 }).success).toBe(false);
  });
});
