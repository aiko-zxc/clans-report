import { beforeEach, describe, expect, it } from 'vitest';
import { POST } from '@/app/api/clans/search/route';
import { truncateAll } from '../helpers/db';
import { insertClan } from '../helpers/factories';

const search = (body: unknown) =>
  POST(new Request('http://localhost/api/clans/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }), {});

const results = async (body: object) => {
  const res = await search({ page: 1, pageSize: 8, ...body });
  expect(res.status).toBe(200);
  return res.json();
};

beforeEach(async () => {
  await truncateAll();
});

describe('POST /api/clans/search', () => {
  it('returns all published clans with empty filters', async () => {
    await insertClan({ name: 'Alpha' });
    await insertClan({ name: 'Bravo' });

    const body = await results({});
    expect(body.total).toBe(2);
    expect(body.items).toHaveLength(2);
    expect(body).toMatchObject({ page: 1, pageSize: 8 });
    expect(body.items[0]).toHaveProperty('bungieGroupId');
    expect(body.items[0]).toHaveProperty('tags');
  });

  it('filters by tag (OR within category)', async () => {
    await insertClan({ name: 'Raiders', tags: ['Raids', 'PvE'] });
    await insertClan({ name: 'Crucible mains', tags: ['Crucible'] });

    const body = await results({ tags: ['Raids'] });
    expect(body.total).toBe(1);
    expect(body.items[0].name).toBe('Raiders');
    expect(body.items[0].tags).toEqual(expect.arrayContaining(['Raids', 'PvE']));
  });

  it('combines filters with AND across categories', async () => {
    await insertClan({ name: 'RU PvE', tags: ['PvE'], language: 'Russian', region: 'EUROPE' });
    await insertClan({ name: 'EN PvE', tags: ['PvE'], language: 'English', region: 'EUROPE' });
    await insertClan({ name: 'RU PvP', tags: ['Crucible'], language: 'Russian', region: 'EUROPE' });

    const body = await results({ tags: ['PvE'], languages: ['Russian'] });
    expect(body.total).toBe(1);
    expect(body.items[0].name).toBe('RU PvE');
  });

  it('filters by region and membership type', async () => {
    await insertClan({ name: 'Open AM', region: 'AMERICAS', membershipType: 'OPEN' });
    await insertClan({ name: 'Closed AM', region: 'AMERICAS', membershipType: 'CLOSED' });
    await insertClan({ name: 'Open EU', region: 'EUROPE', membershipType: 'OPEN' });

    const body = await results({ regions: ['AMERICAS'], membershipTypes: ['OPEN'] });
    expect(body.total).toBe(1);
    expect(body.items[0].name).toBe('Open AM');
  });

  it('filters by platform (owner-supplied, OR within)', async () => {
    await insertClan({ name: 'PC only', platforms: ['PC'] });
    await insertClan({ name: 'Console', platforms: ['PLAYSTATION', 'XBOX'] });

    const body = await results({ platforms: ['XBOX'] });
    expect(body.total).toBe(1);
    expect(body.items[0].name).toBe('Console');
  });

  it('name search is case-insensitive substring', async () => {
    await insertClan({ name: 'Moon Wolves' });
    await insertClan({ name: 'Sun Hunters' });

    expect((await results({ name: 'moon' })).total).toBe(1);
    expect((await results({ name: 'oon wol' })).total).toBe(1);
    expect((await results({ name: 'nope' })).total).toBe(0);
  });

  it('treats % and _ in name as literals (escaped)', async () => {
    await insertClan({ name: '50% winrate' });
    await insertClan({ name: 'plain' });

    // '%' matches only the literal-percent clan, not everything
    expect((await results({ name: '50%' })).total).toBe(1);
    expect((await results({ name: '%' })).total).toBe(1);
  });

  describe('member-count filter with size-tag boundaries (19/20/50/51)', () => {
    beforeEach(async () => {
      for (const n of [19, 20, 50, 51]) await insertClan({ name: `n${n}`, memberCount: n });
    });

    it('minMembers is inclusive', async () => {
      const body = await results({ minMembers: 20 });
      expect(body.items.map((c: { name: string }) => c.name).sort()).toEqual(['n20', 'n50', 'n51']);
    });

    it('maxMembers is inclusive', async () => {
      const body = await results({ maxMembers: 50 });
      expect(body.items.map((c: { name: string }) => c.name).sort()).toEqual(['n19', 'n20', 'n50']);
    });

    it('range min..max inclusive on both ends', async () => {
      const body = await results({ minMembers: 20, maxMembers: 50 });
      expect(body.items.map((c: { name: string }) => c.name).sort()).toEqual(['n20', 'n50']);
    });
  });

  it('paginates and reports total independent of page', async () => {
    for (let i = 0; i < 10; i++) await insertClan({ name: `c${i}` });

    const p1 = await results({ page: 1, pageSize: 8 });
    expect(p1.total).toBe(10);
    expect(p1.items).toHaveLength(8);

    const p2 = await results({ page: 2, pageSize: 8 });
    expect(p2.total).toBe(10);
    expect(p2.items).toHaveLength(2);
  });

  it('sorts by updatedAt DESC (newest activity first)', async () => {
    await insertClan({ name: 'older', updatedAt: new Date('2026-01-01T00:00:00Z') });
    await insertClan({ name: 'newer', updatedAt: new Date('2026-06-01T00:00:00Z') });

    const body = await results({});
    expect(body.items.map((c: { name: string }) => c.name)).toEqual(['newer', 'older']);
  });

  it('400s on invalid request (pageSize > 50)', async () => {
    const res = await search({ page: 1, pageSize: 51 });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('INVALID_REQUEST');
  });

  it('400s when minMembers > maxMembers', async () => {
    const res = await search({ page: 1, pageSize: 8, minMembers: 50, maxMembers: 20 });
    expect(res.status).toBe(400);
  });
});
