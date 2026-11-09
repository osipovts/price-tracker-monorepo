import {
  Alert,
  Button,
  Card,
  Container,
  Group,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { BRAND_FONT, explainLoginRefusal } from 'frontend-shared';
import { type ReactElement, type SyntheticEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate } from 'react-router';

import { LanguageControl } from '../../app/language.component.js';
import { useLogin, useMe } from './use-me.hook.js';

export function LoginPage(): ReactElement {
  const { t } = useTranslation();
  const me = useMe();
  const login = useLogin();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  if (me.data !== null && me.data !== undefined) return <Navigate to="/" replace />;

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault();
    login.mutate({ email, password }, { onSuccess: (): void => void navigate('/') });
  };

  return (
    <Container size="xs" mt={96}>
      <Card withBorder padding="xl">
        <form onSubmit={submit}>
          <Stack>
            <Group justify="space-between" align="flex-end">
              <Stack gap={0}>
                <Text ff={BRAND_FONT} fz={40} lh={1.1}>
                  {t('shell.brand')}
                </Text>
                <Title order={2}>{t('login.title')}</Title>
              </Stack>
              <LanguageControl />
            </Group>
            <TextInput
              label={t('login.email')}
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event): void => {
                setEmail(event.currentTarget.value);
              }}
            />
            <PasswordInput
              label={t('login.password')}
              autoComplete="current-password"
              required
              value={password}
              onChange={(event): void => {
                setPassword(event.currentTarget.value);
              }}
            />
            {login.error !== null && (
              <Alert color="red" role="alert">
                {explainLoginRefusal(login.error, t)}
              </Alert>
            )}
            <Button type="submit" loading={login.isPending}>
              {t('login.submit')}
            </Button>
          </Stack>
        </form>
      </Card>
    </Container>
  );
}
