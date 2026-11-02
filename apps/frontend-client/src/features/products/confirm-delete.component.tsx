import { Button, Group, Modal, Stack, Text } from '@mantine/core';
import type { UseMutationResult } from '@tanstack/react-query';
import { ErrorAlert } from 'frontend-shared';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

/** Asks to confirm a deletion, and makes it by the id; closes when it is made. */
export function ConfirmDelete({
  id,
  remove,
  title,
  text,
  action,
  opened,
  onClose,
  onDeleted,
}: {
  id: string;
  remove: UseMutationResult<void, Error, string>;
  title: string;
  text: string;
  action: string;
  opened: boolean;
  onClose: () => void;
  onDeleted?: () => void;
}): ReactElement {
  const { t } = useTranslation();

  return (
    <Modal opened={opened} title={title} onClose={onClose}>
      <Stack>
        <Text>{text}</Text>
        {remove.error !== null && <ErrorAlert error={remove.error} />}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t('product.cancel')}
          </Button>
          <Button
            color="red"
            loading={remove.isPending}
            onClick={(): void => {
              remove.mutate(id, {
                onSuccess: (): void => {
                  onClose();
                  onDeleted?.();
                },
              });
            }}
          >
            {action}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
