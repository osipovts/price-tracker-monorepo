import { createBrowserRouter } from 'react-router';

import { LoginPage } from '../features/auth/login.page.js';
import { PrivacyPolicyPage, TermsOfServicePage } from '../features/legal/legal.page.js';
import { GroupPage } from '../features/products/group.page.js';
import { ProductsPage } from '../features/products/products.page.js';
import { SettingsPage } from '../features/settings/settings.page.js';
import { ClientShell } from './client-shell.component.js';
import { ProtectedRoute } from './protected-route.component.js';

export function createAppRouter(basename: string): ReturnType<typeof createBrowserRouter> {
  return createBrowserRouter(
    [
      { path: '/login', element: <LoginPage /> },
      // The legal texts are open to anybody: the login through Google asks for pages that need no login.
      { path: '/privacy', element: <PrivacyPolicyPage /> },
      { path: '/terms', element: <TermsOfServicePage /> },
      {
        element: <ProtectedRoute />,
        children: [
          {
            element: <ClientShell />,
            children: [
              { index: true, element: <ProductsPage /> },
              { path: 'groups/:id', element: <GroupPage /> },
              { path: 'settings', element: <SettingsPage /> },
            ],
          },
        ],
      },
    ],
    { basename },
  );
}
