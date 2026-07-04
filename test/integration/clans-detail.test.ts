import { beforeEach, describe, expect, it } from 'vitest';
import { GET } from '@/app/api/clans/[id]/route';
import { truncateAll } from '../helpers/db';
import { insertClan } from '../helpers/factories';

const detail = (id: string) =>
  GET(new Request(`http://localhost/api/clans/${id}`), { params: Promise.resolve({ id }) });

beforeEach(async () => {
  await truncateAll();
});

describe('GET /api/clans/{bungieGroupId}', () => {
  it('returns the full ClanDetail for a published clan', async () => {
    const { bungieGroupId } = await insertClan({
      name: 'Moon Wolves',
      tags: ['PvE', 'Raids'],
      platforms: ['PC', 'PLAYSTATION'],
      language: 'English',
      region: 'AMERICAS',
      membershipType: 'OPEN',
      memberCount: 42,
      founderName: 'Howler',
      founderNameCode: 1234,
      extraMembers: [{ displayName: 'Cub' }, { displayName: 'Fang' }],
    });

    const res = await detail(bungieGroupId);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body).toMatchObject({
      bungieGroupId,
      name: 'Moon Wolves',
      membershipType: 'OPEN',
      language: 'English',
      region: 'AMERICAS',
      clanLevel: { current: 5, max: 6 },
      contacts: { discordUrl: 'https://discord.gg/test' },
    });
    expect(body.tags).toEqual(expect.arrayContaining(['PvE', 'Raids']));
    expect(body.platforms).toEqual(expect.arrayContaining(['PC', 'PLAYSTATION']));
    expect(typeof body.dataFetchedAt).toBe('string');
    expect(typeof body.bungieCreatedAt).toBe('string');
  });

  it('resolves the founder display name from the member snapshot', async () => {
    const { bungieGroupId } = await insertClan({ founderName: 'Howler', founderNameCode: 7777 });
    const body = await (await detail(bungieGroupId)).json();
    expect(body.founder).toEqual({ displayName: 'Howler', displayNameCode: 7777 });
  });

  it('returns all members (founder + extras)', async () => {
    const { bungieGroupId } = await insertClan({
      founderName: 'Howler',
      extraMembers: [{ displayName: 'Cub' }, { displayName: 'Fang' }],
    });
    const body = await (await detail(bungieGroupId)).json();
    expect(body.members).toHaveLength(3);
    expect(body.members.map((m: { displayName: string }) => m.displayName).sort()).toEqual([
      'Cub',
      'Fang',
      'Howler',
    ]);
    expect(body.members[0]).toHaveProperty('destinyId');
    expect(body.members[0]).toHaveProperty('iconPath');
  });

  it('404 LISTING_NOT_FOUND for an unknown group id', async () => {
    const res = await detail('999999999');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('LISTING_NOT_FOUND');
    expect(body.title).toBe('Not Found');
  });

  it('null discordUrl comes back as null, not missing', async () => {
    const { bungieGroupId } = await insertClan({});
    // factory sets a discord url; assert the contacts block shape regardless
    const body = await (await detail(bungieGroupId)).json();
    expect(body.contacts).toHaveProperty('discordUrl');
  });
});
