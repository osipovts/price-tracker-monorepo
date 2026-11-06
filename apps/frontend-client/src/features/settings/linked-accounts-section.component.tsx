import { Badge, Button, Card, Group, Loader, Stack, Text, Title } from '@mantine/core';
import { ErrorAlert, useLocale } from 'frontend-shared';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { PasswordIcon, ProviderIcon } from '../auth/provider-icon.component.js';
import { providerName } from '../auth/provider-name.type.js';
import { formatMoment } from '../products/moment-format.type.js';
import { type LinkedProviderType, useAccountInfo, useUnlinkProvider } from './use-account.hook.js';

function ProviderRow({
  provider,
  linkedAt,
  onlyWay,
}: {
  provider: LinkedProviderType;
  linkedAt: string;
  onlyWay: boolean;
}): ReactElement {
  const { t } = useTranslation();
  const locale = useLocale();
  const unlink = useUnlinkProvider();

  return (
    <Group justify="space-between" wrap="nowrap" align="flex-start">
      <Stack gap={2}>
        <Group gap="xs">
          <ProviderIcon provider={provider} />
          <Text fw={500}>{providerName(provider)}</Text>
          {onlyWay && <Badge color="blue">{t('settings.onlyWay')}</Badge>}
        </Group>
        <Text size="xs" c="dimmed">
          {t('settings.linkedOn', { when: formatMoment(linkedAt, locale) })}
        </Text>
        {unlink.error !== null && <ErrorAlert error={unlink.error} />}
      </Stack>
      <Button
        size="xs"
        variant="light"
        color="red"
        disabled={onlyWay}
        loading={unlink.isPending}
        onClick={(): void => {
          unlink.mutate(provider);
        }}
      >
        {t('settings.unlink')}
      </Button>
    </Group>
  );
}

/** The ways the person logs in: the password, and the accounts at the providers, which they can unlink. */
export function LinkedAccountsSection(): ReactElement {
  const { t } = useTranslation();
  const locale = useLocale();
  const account = useAccountInfo();
  const data = account.data;
  // The last way in cannot be taken away: the account would be lost to its owner.
  const onlyWay = data !== undefined && !data.hasPassword && data.identities.length === 1;

  return (
    <Card withBorder>
      <Stack gap="sm">
        <Title order={4}>{t('settings.linkedAccounts')}</Title>
        {account.isError && <ErrorAlert error={account.error} />}
        {data === undefined ? (
          !account.isError && <Loader size="sm" />
        ) : (
          <>
            {data.hasPassword && (
              <Stack gap={2}>
                <Group gap="xs">
                  <PasswordIcon />
                  <Text fw={500}>{t('settings.passwordWay')}</Text>
                </Group>
                <Text size="xs" c="dimmed">
                  {t('settings.createdOn', { when: formatMoment(data.createdAt, locale) })}
                </Text>
              </Stack>
            )}
            {data.identities.map((identity): ReactElement => (
              <ProviderRow
                key={identity.provider}
                provider={identity.provider}
                linkedAt={identity.linkedAt}
                onlyWay={onlyWay}
              />
            ))}
            {data.identities.length === 0 && (
              <Text size="sm" c="dimmed">
                {t('settings.noProviders')}
              </Text>
            )}
          </>
        )}
      </Stack>
    </Card>
  );
}
