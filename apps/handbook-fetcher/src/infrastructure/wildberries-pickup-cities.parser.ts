import type { CityInterface } from '../domain/city.interface.js';

/** A pickup point of Wildberries: its address, and the region (`dest`) the prices of the site are given for. */
export interface WildberriesPickupPointInterface {
  address: string;
  dest: number;
}

/** A part of an address that names a region, not a settlement. */
const regionPattern =
  /(?:^|\s)(?:обл\.?|область|край|респ\.?|республика|ао|автономн\S*|округ)(?:\s|$)|^(?:республика|респ\.)\s/i;
/** A part that names a district of a region, which comes between the region and the settlement. */
const districtPattern =
  /(?:^|\s)(?:г\.\s?о\.|м\.\s?о\.|г\.о|м\.о|р-н|м\.р-н|район|\(район\)|улус|муниципальн\S*)(?:\s|$)/i;
/** The names of the kinds of a town, before its name. */
const townPrefix = /^(?:г\.|г|город)\s+/i;
/** The kinds of the settlements that are not towns: a village, a settlement and the like. */
const villagePrefix =
  /^(?:с|с\.|село|п|п\.|пос\.?|посёлок|поселок|пгт\.?|посёлок городского типа|поселок городского типа|рабочий посёлок|рабочий поселок|рп\.?|р\.п\.|д|д\.|дер\.?|деревня|ст-ца|станица|х\.?|хутор|аул|снт|кп|днп|тер\.?|мкр\.?|сл\.?|слобода)\s+/i;
/** A part that is a street or a house, which an address without a settlement begins with. */
const streetPattern =
  /\d|(?:^|\s)(?:ул\.?|улица|пр-т|проспект|пр\.|шоссе|ш\.|переулок|пер\.|бульвар|б-р|наб\.?|набережная|площадь|пл\.|проезд|тракт|мкр|микрорайон|квартал|тупик)(?:\s|$)/i;

interface TownInterface {
  name: string;
  region: string | null;
}

/** The region as the addresses write it, made the same for the ways of writing it. */
function regionKey(region: string): string {
  return region
    .toLocaleLowerCase('ru')
    .replace(/(?<=^|\s)обл\.?(?=\s|$)/, 'область')
    .replace(/(?<=^|\s)респ\.?(?=\s|$)/, 'республика')
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The towns that have pickup points of Wildberries. A town is given the region its points name; a town with
 * points in several regions is several towns. Its id is the `dest` most of its points have, and the `dest` of
 * the others are its aliases: the prices are the same for all the points of a town.
 */
export class WildberriesPickupCitiesParser {
  parse(points: readonly WildberriesPickupPointInterface[]): CityInterface[] {
    const located = points.flatMap((point): Array<{ town: TownInterface; dest: number }> => {
      const town = this.townOf(point.address);

      return town === null ? [] : [{ town, dest: point.dest }];
    });

    // The points that do not name the region go to the town of the name in the region most points name.
    const regionsOfName = new Map<string, Map<string, { region: string; count: number }>>();
    for (const { town } of located) {
      if (town.region === null) continue;

      const regions =
        regionsOfName.get(town.name) ?? new Map<string, { region: string; count: number }>();
      const key = regionKey(town.region);
      const known = regions.get(key);
      regions.set(key, { region: known?.region ?? town.region, count: (known?.count ?? 0) + 1 });
      regionsOfName.set(town.name, regions);
    }

    const towns = new Map<
      string,
      { name: string; region: string | null; dests: Map<number, number> }
    >();
    for (const { town, dest } of located) {
      const regions = regionsOfName.get(town.name);
      const region =
        town.region !== null
          ? (regions?.get(regionKey(town.region))?.region ?? town.region)
          : (Array.from(regions?.values() ?? []).toSorted((a, b): number => b.count - a.count)[0]
              ?.region ?? null);
      const key = `${town.name}\n${region === null ? '' : regionKey(region)}`;
      const entry = towns.get(key) ?? { name: town.name, region, dests: new Map<number, number>() };
      entry.dests.set(dest, (entry.dests.get(dest) ?? 0) + 1);
      towns.set(key, entry);
    }

    // Two towns of one id are one town written two ways: the one with more points names it.
    const byId = new Map<string, { city: CityInterface; points: number }>();
    for (const town of towns.values()) {
      const [dest] = Array.from(town.dests.entries()).toSorted(
        ([destA, countA], [destB, countB]): number => countB - countA || destA - destB,
      )[0] ?? [undefined];
      if (dest === undefined) continue;

      const id = String(dest);
      const points = Array.from(town.dests.values()).reduce((sum, count): number => sum + count, 0);
      const known = byId.get(id);
      const aliases = Array.from(
        new Set([...Array.from(town.dests.keys(), String), ...(known?.city.aliases ?? [])]),
      )
        .filter((alias): boolean => alias !== id)
        .toSorted();
      const named = known === undefined || known.points < points ? town : known.city;
      byId.set(id, {
        city: { id, name: named.name, region: named.region, aliases },
        points: points + (known?.points ?? 0),
      });
    }

    return Array.from(byId.values(), ({ city }): CityInterface => city);
  }

  /** The town the address is in; null for a village, or an address that names no settlement. */
  private townOf(address: string): TownInterface | null {
    const parts = address
      .split(',')
      .map((part): string => part.trim())
      .filter((part): boolean => part !== '' && part !== 'Россия');
    let region: string | null = null;
    let index = 0;
    while (index < parts.length - 1) {
      const part = parts[index] ?? '';
      if (districtPattern.test(part)) {
        index += 1;
      } else if (regionPattern.test(part)) {
        region ??= part;
        index += 1;
      } else {
        break;
      }
    }

    const settlement = parts[index];
    if (settlement === undefined || villagePrefix.test(settlement)) return null;

    const name = settlement.replace(townPrefix, '').trim();
    if (name === '' || streetPattern.test(name) || !/^\p{Lu}/u.test(name)) return null;

    return { name, region };
  }
}
