import { AppShell, Burger, Button, Group, NavLink, Stack, Text, Title } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { BRAND_FONT, ColorSchemeControl } from 'frontend-shared';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink as RouterLink, Outlet, useNavigate } from 'react-router';

import { useLogout, useMe } from '../features/auth/use-me.hook.js';
import { LanguageControl } from './language.component.js';

const sections = [
  { to: '/', label: 'shell.dashboard', end: true },
  { to: '/jobs', label: 'shell.jobs', end: false },
  { to: '/groups', label: 'shell.groups', end: false },
  { to: '/proxies', label: 'shell.proxies', end: false },
  { to: '/handbooks', label: 'shell.handbooks', end: false },
] as const;

/** The client app: the hub serves it apart from the panel, under its own path. */
const appUrl = '/app/';

/** The name of the app in its own font, and that this is its admin panel, with the release. */
function Brand(): ReactElement {
  const { t } = useTranslation();

  return (
    <Group gap="xs" align="baseline" wrap="nowrap">
      <Title order={4} ff={BRAND_FONT} fz={32} fw={400} lh={1}>
        {t('shell.brand')}
      </Title>
      <Text size="sm" c="dimmed" title={`v${APP_VERSION}`}>
        {t('shell.title')} v{APP_VERSION}
      </Text>
    </Group>
  );
}

export function AdminShell(): ReactElement {
  const { t } = useTranslation();
  const me = useMe();
  const logout = useLogout();
  const navigate = useNavigate();
  const [opened, navbar] = useDisclosure(false);

  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{ width: 220, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Burger opened={opened} onClick={navbar.toggle} hiddenFrom="sm" size="sm" />
            <Brand />
          </Group>
          <Group gap="sm" visibleFrom="md" wrap="nowrap">
            <LanguageControl />
            <ColorSchemeControl size="xs" />
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="xs">
        <AppShell.Section grow>
          {sections.map((section): ReactElement => (
            <NavLink
              key={section.to}
              component={RouterLink}
              to={section.to}
              end={section.end}
              label={t(section.label)}
              onClick={navbar.close}
            />
          ))}
        </AppShell.Section>
        <AppShell.Section>
          <NavLink href={appUrl} label={t('shell.app')} />
          <Stack gap="xs" p="xs">
            <Group gap="xs" hiddenFrom="md">
              <LanguageControl />
              <ColorSchemeControl size="xs" />
            </Group>
            <Text size="xs" c="dimmed" style={{ overflowWrap: 'anywhere' }}>
              {me.data?.email}
            </Text>
            <Button
              size="xs"
              variant="default"
              loading={logout.isPending}
              onClick={(): void => {
                logout.mutate(undefined, { onSuccess: (): void => void navigate('/login') });
              }}
            >
              {t('common.logOut')}
            </Button>
          </Stack>
        </AppShell.Section>
      </AppShell.Navbar>
      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
