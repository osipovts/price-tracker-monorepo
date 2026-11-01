import { Button, CloseButton, Group, Modal, Stack, Text } from '@mantine/core';
import { ErrorAlert } from 'frontend-shared';
import { type ReactElement, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDeleteGroup } from './use-product-groups.hook.js';

/** A button that asks to confirm, and deletes the group with the tracking of its products. */
export function DeleteGroup({
  groupId,
  title,
  onDeleted,
}: {
  groupId: string;
  title: string;
  onDeleted?: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const [asking, setAsking] = useState(false);
  const remove = useDeleteGroup();

  return (
    <>
      <CloseButton
        aria-label={t('groups.delete')}
        title={t('groups.delete')}
        c="red"
        onClick={(): void => {
          setAsking(true);
        }}
      />
      <Modal
        opened={asking}
        title={t('groups.deleteTitle')}
        onClose={(): void => {
          setAsking(false);
        }}
      >
        <Stack>
          <Text>{t('groups.deleteText', { title })}</Text>
          {remove.error !== null && <ErrorAlert error={remove.error} />}
          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={(): void => {
                setAsking(false);
              }}
            >
              {t('product.cancel')}
            </Button>
            <Button
              color="red"
              loading={remove.isPending}
              onClick={(): void => {
                remove.mutate(groupId, {
                  onSuccess: (): void => {
                    setAsking(false);
                    onDeleted?.();
                  },
                });
              }}
            >
              {t('groups.delete')}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
