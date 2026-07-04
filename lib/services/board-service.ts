import {
  getClanDetail,
  searchClans,
  type ClanCard,
  type ClanDetail,
} from '@/lib/db/repos/clan-listing-repo';
import { AppError } from '@/lib/errors';
import type { SearchClansRequest } from '@/lib/validation';

export interface SearchResult {
  items: ClanCard[];
  total: number;
  page: number;
  pageSize: number;
}

export async function search(criteria: SearchClansRequest): Promise<SearchResult> {
  const { items, total } = await searchClans(criteria);
  return { items, total, page: criteria.page, pageSize: criteria.pageSize };
}

export async function detail(bungieGroupId: string): Promise<ClanDetail> {
  const clan = await getClanDetail(bungieGroupId);
  if (!clan) throw new AppError('LISTING_NOT_FOUND', 'This clan listing no longer exists.');
  return clan;
}
