// Escape a user string for safe use inside a LIKE/ILIKE pattern: the wildcards
// %, _ and the escape char \ are neutralised so they match literally. Postgres
// LIKE uses backslash as the default ESCAPE character. Caller wraps in %...%.
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}
