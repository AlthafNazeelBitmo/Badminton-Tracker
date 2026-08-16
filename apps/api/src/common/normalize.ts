/**
 * Name normalisation used for deduplication.
 *
 * The rule the product needs: typing "john carter", "John  Carter" or "JOHN CARTER"
 * during quick entry must all resolve to the same existing player, so a person is never
 * silently duplicated. Accents are preserved rather than stripped — "Muñoz" and "Munoz"
 * may well be different people, and merging them is not ours to decide.
 */
export function normalizeName(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
}

/** Title-cases a typed name for storage, leaving already-mixed-case input alone. */
export function tidyDisplayName(value: string): string {
  const collapsed = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (collapsed !== collapsed.toLocaleLowerCase('en')) return collapsed;

  return collapsed
    .split(' ')
    .map((word) => word.charAt(0).toLocaleUpperCase('en') + word.slice(1))
    .join(' ');
}
