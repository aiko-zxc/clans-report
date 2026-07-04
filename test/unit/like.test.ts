import { describe, expect, it } from 'vitest';
import { escapeLike } from '@/lib/like';

describe('escapeLike', () => {
  it('escapes LIKE wildcards so they match literally', () => {
    expect(escapeLike('50%')).toBe('50\\%');
    expect(escapeLike('a_b')).toBe('a\\_b');
    expect(escapeLike('back\\slash')).toBe('back\\\\slash');
  });

  it('leaves ordinary text untouched', () => {
    expect(escapeLike('Moon Wolves')).toBe('Moon Wolves');
  });

  it('escapes all specials in one string', () => {
    expect(escapeLike('%_\\')).toBe('\\%\\_\\\\');
  });
});
