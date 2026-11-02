const storageKey = 'products.pendingAdd';
/** The hub gives up on a link in about a minute: an older record is of an add that is over. */
const maxAgeMs = 5 * 60_000;

export interface PendingAddInterface {
  url: string;
  /** The city asked for, by the id of the marketplace; null when none was. */
  cityId: string | null;
  /** The group the product is added to; null when it goes into a new group. */
  groupId: string | null;
}

/** The link that is being added, kept in the tab so that a reload can ask for it again: the hub joins the add in progress. */
export function rememberPendingAdd(add: PendingAddInterface): void {
  try {
    sessionStorage.setItem(storageKey, JSON.stringify({ ...add, startedAt: Date.now() }));
  } catch {
    /* The storage may be blocked: the reload then forgets the add. */
  }
}

export function forgetPendingAdd(): void {
  try {
    sessionStorage.removeItem(storageKey);
  } catch {
    /* Nothing was kept. */
  }
}

/** The add that was cut short by a reload; null when there is none or it is too old. */
export function readPendingAdd(now: number = Date.now()): PendingAddInterface | null {
  try {
    const raw = sessionStorage.getItem(storageKey);
    const value: unknown = raw === null ? null : JSON.parse(raw);
    if (typeof value !== 'object' || value === null || !('url' in value) || !('startedAt' in value))
      return null;

    const { url, startedAt } = value;
    const cityId = 'cityId' in value && typeof value.cityId === 'string' ? value.cityId : null;
    const groupId = 'groupId' in value && typeof value.groupId === 'string' ? value.groupId : null;

    return typeof url === 'string' && typeof startedAt === 'number' && now - startedAt < maxAgeMs
      ? { url, cityId, groupId }
      : null;
  } catch {
    return null;
  }
}

/** Whether a reload cut short an add to the group, or to a new group when null: its form is opened again. */
export function hasPendingAdd(groupId: string | null): boolean {
  const pending = readPendingAdd();

  return pending !== null && pending.groupId === groupId;
}
