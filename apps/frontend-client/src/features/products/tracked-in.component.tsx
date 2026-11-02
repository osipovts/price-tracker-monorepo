import { Alert, Anchor } from '@mantine/core';
import type { ReactElement } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { useProductGroup } from './use-product-groups.hook.js';

/**
 * Why nothing was added: the user tracks the product already, in the group it is in. A group of a product stays
 * the one it was put in first; another one is linked, and following the link is the end of the form.
 */
export function TrackedIn({
  groupId,
  askedGroupId,
  onFollow,
}: {
  groupId: string;
  askedGroupId: string | null;
  onFollow: () => void;
}): ReactElement | null {
  const { t } = useTranslation();
  const group = useProductGroup(groupId);

  if (groupId === askedGroupId) {
    return <Alert variant="light">{t('products.inThisGroup')}</Alert>;
  }
  if (group.data === undefined) return null;

  return (
    <Alert variant="light">
      <Trans
        i18nKey="products.trackedIn"
        values={{ title: group.data.title ?? t('groups.untitled') }}
        components={{
          group: (
            <Anchor component={Link} to={`/groups/${groupId}`} fz="inherit" onClick={onFollow} />
          ),
        }}
      />
    </Alert>
  );
}
