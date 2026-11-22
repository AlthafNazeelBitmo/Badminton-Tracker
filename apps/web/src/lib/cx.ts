/** Joins class names, skipping falsy entries. Usable from server and client components. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
