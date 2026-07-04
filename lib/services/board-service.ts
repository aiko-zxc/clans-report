import { searchClans, type ClanCard } from '@/lib/db/repos/clan-listing-repo';
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
