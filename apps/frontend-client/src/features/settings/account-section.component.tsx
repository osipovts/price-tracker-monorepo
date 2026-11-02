import { Badge, Button, Card, Group, PasswordInput, Stack, Text, Title } from '@mantine/core';
import { ErrorAlert } from 'frontend-shared';
import { type ReactElement, type SyntheticEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useMe } from '../auth/use-me.hook.js';
import { useChangePassword } from './use-account.hook.js';

function PasswordForm(): ReactElement {
  const { t } = useTranslation();
  const change = useChangePassword();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault();
    change.mutate(
      { currentPassword, newPassword },
      {
        onSuccess: (): void => {
          setCurrentPassword('');
          setNewPassword('');
        },
      },
    );
  };

  return (
    <form onSubmit={submit}>
      <Stack gap="xs" maw={360}>
        <Title order={5}>{t('settings.password')}</Title>
        <PasswordInput
          label={t('settings.currentPassword')}
          autoComplete="current-password"
          required
          value={currentPassword}
          onChange={(event): void => {
            setCurrentPassword(event.currentTarget.value);
          }}
        />
        <PasswordInput
          label={t('settings.newPassword')}
          description={t('settings.newPasswordHint')}
          autoComplete="new-password"
          minLength={8}
          required
          value={newPassword}
          onChange={(event): void => {
            setNewPassword(event.currentTarget.value);
          }}
        />
        {change.error !== null && <ErrorAlert error={change.error} />}
        {change.isSuccess && (
          <Text size="sm" c="green" role="status">
            {t('settings.passwordChanged')}
          </Text>
        )}
        <Group>
          <Button type="submit" loading={change.isPending}>
            {t('settings.changePassword')}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

/** Who the person is, and the way to change the password. */
export function AccountSection(): ReactElement {
  const { t } = useTranslation();
  const me = useMe();

  return (
    <Card withBorder>
      <Stack gap="md">
        <Title order={4}>{t('settings.account')}</Title>
        {me.data !== undefined && me.data !== null && (
          <Group gap="xs">
            <Text fw={500}>{me.data.email}</Text>
            <Badge color={me.data.emailVerified ? 'success' : 'blue'}>
              {me.data.emailVerified ? t('settings.emailVerified') : t('settings.emailNotVerified')}
            </Badge>
          </Group>
        )}
        <PasswordForm />
      </Stack>
    </Card>
  );
}
