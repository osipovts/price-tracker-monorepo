import {
  ActionIcon,
  Alert,
  Anchor,
  AppShell,
  Button,
  Container,
  Group,
  Menu,
  Text,
  Title,
} from '@mantine/core';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Outlet, useNavigate } from 'react-router';

import { useLogout, useMe, useResendVerification } from '../features/auth/use-me.hook.js';
import { BRAND_FONT } from './ayu.theme.js';

/** The person of the button that opens the menu of the account. */
function UserIcon(): ReactElement {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
    </svg>
  );
}

export function ClientShell(): ReactElement {
  const { t } = useTranslation();
  const me = useMe();
  const logout = useLogout();
  const resend = useResendVerification();
  const navigate = useNavigate();

  return (
    <AppShell padding="md">
      {/* As much room above the header as under it. */}
      <AppShell.Main pt={24}>
        <Container size="md">
          <Group mb={24} align="center" justify="space-between" wrap="nowrap">
            <Title order={4} ff={BRAND_FONT} fz={48} fw={400} lh={1}>
              <Anchor
                component={Link}
                to="/"
                c="inherit"
                fz="inherit"
                lh="inherit"
                underline="never"
                title={`v${APP_VERSION}`}
              >
                {t('shell.title')}
              </Anchor>
            </Title>
            {/* The email, the settings and the way out are one menu: the header stays one line on a phone. */}
            <Menu position="bottom-end" width={260} shadow="md">
              <Menu.Target>
                <ActionIcon size={32} variant="default" aria-label={t('shell.account')}>
                  <UserIcon />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label mb="xs" style={{ overflowWrap: 'anywhere' }}>
                  {me.data?.email}
                </Menu.Label>
                <Menu.Item component={Link} to="/settings">
                  {t('shell.settings')}
                </Menu.Item>
                <Menu.Divider />
                <Menu.Item
                  color="red"
                  disabled={logout.isPending}
                  onClick={(): void => {
                    logout.mutate(undefined, { onSuccess: (): void => void navigate('/login') });
                  }}
                >
                  {t('common.logOut')}
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
          {me.data?.emailVerified === false && (
            <Alert color="blue" mb="md" title={t('shell.confirmTitle')}>
              <Group>
                <Text size="sm">{t('shell.confirmText', { email: me.data.email })}</Text>
                <Button
                  size="xs"
                  variant="light"
                  loading={resend.isPending}
                  disabled={resend.isSuccess}
                  onClick={(): void => {
                    resend.mutate();
                  }}
                >
                  {resend.isSuccess ? t('shell.sent') : t('shell.sendAgain')}
                </Button>
              </Group>
            </Alert>
          )}
          <Outlet />
        </Container>
      </AppShell.Main>
    </AppShell>
  );
}
