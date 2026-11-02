import { Modal, Stack, Text } from '@mantine/core';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { AddProduct } from './add-product.component.js';

/**
 * The form of a new product, out of the way of the prices: with no group it starts a new group, with one
 * it adds the same product of another marketplace or city to it. It closes when the product is added.
 */
export function AddProductModal({
  groupId,
  opened,
  onClose,
}: {
  groupId: string | null;
  opened: boolean;
  onClose: () => void;
}): ReactElement {
  const { t } = useTranslation();

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={groupId === null ? t('products.addTitle') : t('group.addTitle')}
      size="lg"
      padding="lg"
      styles={{ title: { fontWeight: 600 } }}
    >
      <Stack gap="md">
        {groupId !== null && (
          <Text size="sm" c="dimmed">
            {t('group.addHint')}
          </Text>
        )}
        <AddProduct groupId={groupId} onAdded={onClose} />
      </Stack>
    </Modal>
  );
}
