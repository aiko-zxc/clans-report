import { describe, expect, it } from 'vitest';
import { AppError, ERROR_STATUS, handled, problem } from '@/lib/errors';

describe('problem()', () => {
  it('maps each code to its status and sets problem+json + code', async () => {
    const res = problem('LISTING_ALREADY_EXISTS', 'You already have a listing.', '/api/me/listing');
    expect(res.status).toBe(409);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
    const body = await res.json();
    expect(body).toMatchObject({
      status: 409,
      code: 'LISTING_ALREADY_EXISTS',
      title: 'Conflict',
      detail: 'You already have a listing.',
      instance: '/api/me/listing',
    });
  });

  it('every ErrorCode has a status', () => {
    for (const status of Object.values(ERROR_STATUS)) {
      expect(typeof status).toBe('number');
    }
  });
});

describe('handled()', () => {
  const req = new Request('https://x.test/api/thing');

  it('passes through a successful response', async () => {
    const res = await handled(async () => Response.json({ ok: true }))(req, {});
    expect(res.status).toBe(200);
  });

  it('converts a thrown AppError into its problem response', async () => {
    const res = await handled(async () => {
      throw new AppError('NOT_FOUNDER', "You don't found a Destiny clan.");
    })(req, {});
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('NOT_FOUNDER');
    expect(body.instance).toBe('/api/thing');
  });

  it('converts an unexpected throw into a 500 INTERNAL', async () => {
    const res = await handled(async () => {
      throw new TypeError('boom');
    })(req, {});
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe('INTERNAL');
  });
});
