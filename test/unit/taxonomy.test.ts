import { describe, expect, it } from 'vitest';
import {
  isBigClan,
  isSmallClan,
  isStale,
  STALENESS_THRESHOLD_MS,
} from '@/lib/taxonomy';

describe('size tags (Small < 20, Big > 50)', () => {
  it('classifies small-clan boundary: 19 small, 20 not', () => {
    expect(isSmallClan(19)).toBe(true);
    expect(isSmallClan(20)).toBe(false);
  });

  it('classifies big-clan boundary: 50 not, 51 big', () => {
    expect(isBigClan(50)).toBe(false);
    expect(isBigClan(51)).toBe(true);
  });

  it('mid-range is neither small nor big (20..50)', () => {
    expect(isSmallClan(35)).toBe(false);
    expect(isBigClan(35)).toBe(false);
  });
});

describe('staleness (> 12h)', () => {
  const now = new Date('2026-07-04T12:00:00Z');

  it('just under threshold is fresh', () => {
    const fetchedAt = new Date(now.getTime() - STALENESS_THRESHOLD_MS + 1000);
    expect(isStale(fetchedAt, now)).toBe(false);
  });

  it('just over threshold is stale', () => {
    const fetchedAt = new Date(now.getTime() - STALENESS_THRESHOLD_MS - 1000);
    expect(isStale(fetchedAt, now)).toBe(true);
  });

  it('exactly at threshold is not yet stale', () => {
    const fetchedAt = new Date(now.getTime() - STALENESS_THRESHOLD_MS);
    expect(isStale(fetchedAt, now)).toBe(false);
  });
});
