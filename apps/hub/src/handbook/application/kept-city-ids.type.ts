import type { HandbookCityType } from 'queue-contract';

/** The ids a city is known by: its own, then its aliases. */
function idsOf(city: HandbookCityType): string[] {
  return [city.id, ...(city.aliases ?? [])];
}

/**
 * The cities of a new read, with the ids the handbook gave them before. A city keeps its id while the
 * marketplace still knows it by it, and keeps the ids it had among its aliases: a product tracked in the city
 * by one of them is found by any other. A city of the read is the one of the handbook of the same name that
 * shares an id with it.
 */
export function keepCityIds(
  previous: readonly HandbookCityType[],
  read: readonly HandbookCityType[],
): HandbookCityType[] {
  const ownIds = new Set(read.map((city): string => city.id));
  const kept = new Set<string>();

  return read.map((city): HandbookCityType => {
    const ids = new Set(idsOf(city));
    const before = previous.find(
      (old): boolean => old.name === city.name && idsOf(old).some((id): boolean => ids.has(id)),
    );
    if (before === undefined) return city;

    // Another city of the read is the one known by the id, or one kept it already: the city takes its new one.
    const keeps =
      before.id === city.id ||
      (ids.has(before.id) && !ownIds.has(before.id) && !kept.has(before.id));
    const id = keeps ? before.id : city.id;
    kept.add(id);
    const aliases = Array.from(new Set([...idsOf(city), ...idsOf(before)]))
      .filter((alias): boolean => alias !== id)
      .toSorted();

    return { ...city, id, ...(aliases.length === 0 ? {} : { aliases }) };
  });
}
