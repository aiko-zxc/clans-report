import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

// MSW server for Bungie (the WireMock analog). Tests register handlers per-case
// via bungie.use(...); the server itself is started/stopped in the integration
// setup. Response factories build Bungie-shaped payloads.
export const bungie = setupServer();

const BASE = 'https://www.bungie.net/Platform';

// Bungie wraps every response in { Response, ErrorCode: 1, ... }.
function ok<T>(response: T) {
  return HttpResponse.json({ Response: response, ErrorCode: 1, ThrottleSeconds: 0 });
}

// GET /GroupV2/{groupId}/ — basic clan info (consumed by S1 cron + preview).
export function getGroupHandler(
  groupId: string,
  overrides: Partial<{ name: string; memberCount: number; founderMembershipId: string }> = {},
) {
  const { name = 'Moon Wolves', memberCount = 42, founderMembershipId = '4611686018429783584' } =
    overrides;
  return http.get(`${BASE}/GroupV2/${groupId}/`, () =>
    ok({
      detail: {
        groupId,
        name,
        motto: 'Howl at the dark',
        about: 'We hunt every Friday.',
        memberCount,
        creationDate: '2020-09-08T00:00:00Z',
        clanInfo: { d2ClanProgressions: { '584850370': { level: 5 } } },
      },
      founder: {
        destinyUserInfo: { membershipId: founderMembershipId, membershipType: 3 },
      },
    }),
  );
}
