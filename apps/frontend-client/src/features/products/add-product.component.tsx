import { Button, Group, type OptionsFilter, Select, Stack, Text, TextInput } from '@mantine/core';
import { ErrorAlert } from 'frontend-shared';
import { type ReactElement, type SyntheticEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

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
  chosen: { value: string; label: string } | null;
  onChoose: (city: { value: string; label: string } | null) => void;
}): ReactElement {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const cities = useCities(marketplace, search, true);
  const found = (cities.data ?? []).map((city): { value: string; label: string } => ({
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
  const [url, setUrl] = useState('');
  const [city, setCity] = useState<{ value: string; label: string } | null>(null);
  const cityMarketplace = cityMarketplaceOf(url);
  const add = useAddProduct();
  const [slow, setSlow] = useState(false);
  const resumed = useRef(false);

  useEffect((): (() => void) | undefined => {
    if (!add.isPending) return undefined;

    const timer = setTimeout((): void => {
      setSlow(true);
    }, slowAddDelayMs);

    return (): void => {
      clearTimeout(timer);
      setSlow(false);
    };
  }, [add.isPending]);

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

        setUrl('');
        setCity(null);
        onDone?.();
      },
    });
  };

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault();
    track({ url, cityId: cityMarketplace === null ? null : (city?.value ?? null), groupId });
  };

  // A reload cut the add short, not stopped it: the hub joins it when the same link is sent again.
  useEffect((): void => {
    // Once, when the page opens: React runs the effect twice in development.
    if (resumed.current) return;

    resumed.current = true;
    const pending = readPendingAdd();
    if (pending?.groupId !== groupId) return;

    setUrl(pending.url);
    track(pending, true);
  }, []);

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
          value={url}
          onChange={(event): void => {
            const next = event.currentTarget.value;
            // A city of one marketplace is no city of another.
            if (cityMarketplaceOf(next) !== cityMarketplace) setCity(null);
            setUrl(next);
            setTrackedIn(null);
          }}
        />
        {cityMarketplace !== null && (
          <CityField
            key={cityMarketplace}
            marketplace={cityMarketplace}
            disabled={add.isPending}
            chosen={city}
            onChoose={setCity}
          />
        )}
        {slow && (
          <Text size="xs" c="dimmed">
            {t('products.addSlow')}
          </Text>
        )}
        {add.error !== null && <ErrorAlert error={add.error} />}
        {trackedIn !== null && (
          <TrackedIn
            groupId={trackedIn}
            askedGroupId={groupId}
            onFollow={(): void => {
              onDone?.();
            }}
          />
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
