import {
  Alert,
  Button,
  Card,
  Container,
  Divider,
  PasswordInput,
  Stack,
  Tabs,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { BRAND_FONT, explainLoginRefusal } from 'frontend-shared';
import { type ReactElement, type SyntheticEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate, useSearchParams } from 'react-router';

import { LegalFooter } from '../legal/legal-footer.component.js';
import { ProviderIcon } from './provider-icon.component.js';
import { providerName } from './provider-name.type.js';
import { useLogin, useMe, useOauthProviders, useRegister, useVerifyEmail } from './use-me.hook.js';

/** Buttons that take the browser to the login of a provider, which brings it back logged in. */
function ProviderButtons(): ReactElement | null {
  const { t } = useTranslation();
  const providers = useOauthProviders();

  if (providers.data === undefined || providers.data.length === 0) return null;

  return (
    <Stack gap="xs" mt="md">
      <Divider label={t('login.or')} labelPosition="center" />
      {providers.data.map((provider): ReactElement => (
        <Button
          key={provider}
          component="a"
          href={`/auth/oauth/${provider}/start`}
          variant="default"
          leftSection={<ProviderIcon provider={provider} />}
        >
          {t('login.continueWith', { provider: providerName(provider) })}
        </Button>
      ))}
    </Stack>
  );
}

/** What the page has to say besides the form: why the user is here, and why the last try did not work. */
function Notices({
  verifying,
  oauthFailed,
  failure,
}: {
  verifying: boolean;
  oauthFailed: boolean;
  failure: Error | null;
}): ReactElement {
  const { t } = useTranslation();

  return (
    <>
      {verifying && (
        <Alert color="yellow" role="status">
          {t('login.confirmEmail')}
        </Alert>
      )}
      {oauthFailed && failure === null && (
        <Alert color="red" role="alert">
          {t('login.oauthFailed')}
        </Alert>
      )}
      {failure !== null && (
        <Alert color="red" role="alert">
          {explainLoginRefusal(failure, t)}
        </Alert>
      )}
    </>
  );
}

export function LoginPage(): ReactElement {
  const { t } = useTranslation();
  const me = useMe();
  const login = useLogin();
  const register = useRegister();
  const verifyEmail = useVerifyEmail();
  const navigate = useNavigate();
  const [mode, setMode] = useState<string | null>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const signingUp = mode === 'register';
  const [params] = useSearchParams();
  const oauthFailed = params.get('error') === 'oauth';
  // The link of the mail, opened where nobody is signed in: the hub sends the user here with its token.
  const verifyToken = params.get('verify');
  const failure = signingUp ? (register.error ?? login.error) : login.error;

  if (me.data !== null && me.data !== undefined) return <Navigate to="/" replace />;

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault();
    const enter = (): void => {
      login.mutate(
        { email, password },
        {
          onSuccess: (): void => {
            // Whether the link still works or not, the user is in: the page of the app says what is left to do.
            if (verifyToken === null) void navigate('/');
            else verifyEmail.mutate(verifyToken, { onSettled: (): void => void navigate('/') });
          },
        },
      );
    };
    // Signing up starts no session: the person is logged in right after.
    if (signingUp) register.mutate({ email, password }, { onSuccess: enter });
    else enter();
  };

  return (
    <Container size="xs" mt={{ base: 24, sm: 96 }}>
      <Card withBorder padding="xl">
        <form onSubmit={submit}>
          <Stack>
            <Stack gap={0} align="center">
              <Title order={2} ff={BRAND_FONT} fz={64} fw={400} lh={1.1}>
                {t('login.title')}
              </Title>
              <Text size="sm" c="dimmed" ta="center">
                {t('brand.slogan')}
              </Text>
            </Stack>
            <Tabs value={mode} onChange={setMode}>
              <Tabs.List grow>
                <Tabs.Tab value="login">{t('login.logIn')}</Tabs.Tab>
                <Tabs.Tab value="register">{t('login.signUp')}</Tabs.Tab>
              </Tabs.List>
            </Tabs>
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
              autoComplete={signingUp ? 'new-password' : 'current-password'}
              required
              value={password}
              onChange={(event): void => {
                setPassword(event.currentTarget.value);
              }}
            />
            <Notices verifying={verifyToken !== null} oauthFailed={oauthFailed} failure={failure} />
            <Button type="submit" loading={login.isPending || register.isPending}>
              {signingUp ? t('login.signUp') : t('login.logIn')}
            </Button>
          </Stack>
        </form>
        <ProviderButtons />
      </Card>
      <LegalFooter />
    </Container>
  );
}
