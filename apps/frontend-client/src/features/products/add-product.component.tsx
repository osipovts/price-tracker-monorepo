import { Button, Group, type OptionsFilter, Select, Stack, Text, TextInput } from '@mantine/core';
import { ErrorAlert } from 'frontend-shared';
import { type ReactElement, type SyntheticEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type CityChoiceInterface, readRememberedCity, rememberCity } from './city-choice.type.js';
import { cityMarketplaceOf, type CityMarketplaceType } from './city-link.type.js';
import { type PendingAddInterface, readPendingAdd } from './pending-add.type.js';
import { TrackedIn } from './tracked-in.component.js';
import { useAddProduct, useCities } from './use-products.hook.js';

/** How long a product may be added before the user is told that it can take minutes. */
const slowAddDelayMs = 5000;

/** The hub gives the cities that match, the best first: the list is not filtered again here. */
const keepAll: OptionsFilter = ({ options }) => options;

function cityLabel(city: { name: string; region: string | null }): string {
  return city.region === null ? city.name : `${city.name} (${city.region})`;
}

/** Searches the cities of the marketplace by what is typed, and tells the one that is chosen. */
function CityField({
  marketplace,
  disabled,
  chosen,
  onChoose,
}: {
  marketplace: CityMarketplaceType;
  disabled: boolean;
  chosen: CityChoiceInterface | null;
  onChoose: (city: CityChoiceInterface | null) => void;
}): ReactElement {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const cities = useCities(marketplace, search, true);
  const found = (cities.data ?? []).map((city): CityChoiceInterface => ({
    value: city.id,
    label: cityLabel(city),
  }));
  // The chosen city stays among the options when the search moves on, or the field would lose its name.
  const options =
    chosen === null || found.some((city): boolean => city.value === chosen.value)
      ? found
      : [chosen, ...found];

  return (
    <Select
      label={t('products.city')}
      description={t('products.cityHint')}
      placeholder={t('products.cityPlaceholder')}
      nothingFoundMessage={t('products.cityNothing')}
      searchable
      clearable
      disabled={disabled}
      data={options}
      value={chosen?.value ?? null}
      searchValue={search}
      filter={keepAll}
      onSearchChange={setSearch}
      onChange={(value, option): void => {
        onChoose(value === null || option === null ? null : { value, label: option.label });
      }}
    />
  );
}

/** Whether the add has gone on for longer than `slowAddDelayMs`. */
function useSlowAdd(pending: boolean): boolean {
  const [slow, setSlow] = useState(false);

  useEffect((): (() => void) | undefined => {
    if (!pending) return undefined;

    const timer = setTimeout((): void => {
      setSlow(true);
    }, slowAddDelayMs);

    return (): void => {
      clearTimeout(timer);
      setSlow(false);
    };
  }, [pending]);

  return slow;
}

/**
 * A reload cut the add to the group short, not stopped it: it is resumed once, when the form opens, and the hub
 * joins it when the same link is sent again.
 */
function useResumedAdd(
  groupId: string | null,
  resume: (pending: PendingAddInterface) => void,
): void {
  const resumed = useRef(false);

  useEffect((): void => {
    // Once, when the page opens: React runs the effect twice in development.
    if (resumed.current) return;

    resumed.current = true;
    const pending = readPendingAdd();
    if (pending?.groupId === groupId) resume(pending);
  }, []);
}

interface LinkCityInterface {
  url: string;
  /** The marketplace of the link when its prices depend on the city; null for the others. */
  marketplace: CityMarketplaceType | null;
  city: CityChoiceInterface | null;
  /** The city sent with the link: none for a marketplace whose prices do not depend on it. */
  cityId: string | null;
  changeUrl: (url: string) => void;
  chooseCity: (city: CityChoiceInterface | null) => void;
  clear: () => void;
}

/** The link typed and the city picked for it: a marketplace that has cities starts with the one picked last for it. */
function useLinkCity(): LinkCityInterface {
  const [url, setUrl] = useState('');
  const [city, setCity] = useState<CityChoiceInterface | null>(null);
  const marketplace = cityMarketplaceOf(url);

  return {
    url,
    marketplace,
    city,
    cityId: marketplace === null ? null : (city?.value ?? null),
    changeUrl: (next: string): void => {
      const nextMarketplace = cityMarketplaceOf(next);
      // A city of one marketplace is no city of another.
      if (nextMarketplace !== marketplace) {
        setCity(nextMarketplace === null ? null : readRememberedCity(nextMarketplace));
      }
      setUrl(next);
    },
    chooseCity: (chosen: CityChoiceInterface | null): void => {
      setCity(chosen);
      if (marketplace !== null) rememberCity(marketplace, chosen);
    },
    clear: (): void => {
      setUrl('');
      setCity(null);
    },
  };
}

/**
 * Adds a product by its link: to the group, or to a new group of its own when there is none. A product being
 * added to a group that a reload cut short is asked for again where it was started from.
 */
export function AddProduct({
  groupId,
  onDone,
}: {
  groupId: string | null;
  /** The product is added, or the user goes to the group that has it already. */
  onDone?: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const link = useLinkCity();
  const add = useAddProduct();
  const slow = useSlowAdd(add.isPending);
  const done = (): void => {
    onDone?.();
  };

  // The group of a product the user tracks already: the form stays, and says where the product is.
  const [trackedIn, setTrackedIn] = useState<string | null>(null);

  /** A resent add that a reload cut short finds its own product tracked: that is its success, not a product tracked before. */
  const track = (adding: PendingAddInterface, resent = false): void => {
    setTrackedIn(null);
    add.mutate(adding, {
      onSuccess: (added): void => {
        if (added.trackedAlready && !resent) {
          setTrackedIn(added.groupId);

          return;
        }

        link.clear();
        done();
      },
    });
  };

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault();
    track({ url: link.url, cityId: link.cityId, groupId });
  };

  useResumedAdd(groupId, (pending): void => {
    link.changeUrl(pending.url);
    track(pending, true);
  });

  return (
    <form onSubmit={submit}>
      <Stack gap="sm">
        <TextInput
          label={t('products.linkLabel')}
          description={t('products.supported')}
          placeholder="https://www.ozon.ru/product/..."
          type="url"
          required
          data-autofocus
          disabled={add.isPending}
          value={link.url}
          onChange={(event): void => {
            link.changeUrl(event.currentTarget.value);
            setTrackedIn(null);
          }}
        />
        {link.marketplace !== null && (
          <CityField
            key={link.marketplace}
            marketplace={link.marketplace}
            disabled={add.isPending}
            chosen={link.city}
            onChoose={link.chooseCity}
          />
        )}
        {slow && (
          <Text size="xs" c="dimmed">
            {t('products.addSlow')}
          </Text>
        )}
        {add.error !== null && <ErrorAlert error={add.error} />}
        {trackedIn !== null && (
          <TrackedIn groupId={trackedIn} askedGroupId={groupId} onFollow={done} />
        )}
        <Group justify="flex-end">
          <Button type="submit" loading={add.isPending}>
            {t('products.track')}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
