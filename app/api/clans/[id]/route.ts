import { handled } from '@/lib/errors';
import { detail } from '@/lib/services/board-service';

export const GET = handled(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const clan = await detail(id);
  return Response.json(clan);
});
