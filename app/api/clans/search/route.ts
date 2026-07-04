import { handled } from '@/lib/errors';
import { search } from '@/lib/services/board-service';
import { parse, searchClansRequest } from '@/lib/validation';

export const POST = handled(async (req: Request) => {
  const criteria = parse(searchClansRequest, await req.json());
  const result = await search(criteria);
  return Response.json(result);
});
