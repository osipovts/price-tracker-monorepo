import type { CityMarketplaceType } from './city-link.type.js';

/** A city of a marketplace as the field of the city has it: its id at the marketplace, and its name with the region. */
export interface CityChoiceInterface {
  value: string;
  label: string;
}

/** The ids of the cities differ between the marketplaces: each keeps its own. */
function storageKey(marketplace: CityMarketplaceType): string {
  return `products.city.${marketplace}`;
}

/** The city picked for the marketplace is kept by the browser, for the next product of it; null forgets it. */
export function rememberCity(
  marketplace: CityMarketplaceType,
  city: CityChoiceInterface | null,
): void {
  try {
    if (city === null) localStorage.removeItem(storageKey(marketplace));
    else localStorage.setItem(storageKey(marketplace), JSON.stringify(city));
  } catch {
    /* The storage may be blocked: the city is then asked for every time. */
  }
}

/** The city picked last for the marketplace; null when none is kept, or what is kept is no city. */
export function readRememberedCity(marketplace: CityMarketplaceType): CityChoiceInterface | null {
  try {
    const raw = localStorage.getItem(storageKey(marketplace));
    const value: unknown = raw === null ? null : JSON.parse(raw);
    if (typeof value !== 'object' || value === null || !('value' in value) || !('label' in value))
      return null;

    const { value: id, label } = value;

    return typeof id === 'string' && typeof label === 'string' ? { value: id, label } : null;
  } catch {
    return null;
  }
}
