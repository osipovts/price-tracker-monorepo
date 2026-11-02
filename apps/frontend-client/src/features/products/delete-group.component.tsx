import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { ConfirmDelete } from './confirm-delete.component.js';
import { useDeleteGroup } from './use-product-groups.hook.js';

/** Asks to confirm, and deletes the group with the tracking of its products. */
export function DeleteGroup({
  groupId,
  title,
  opened,
  onClose,
  onDeleted,
}: {
  groupId: string;
  title: string;
  opened: boolean;
  onClose: () => void;
  onDeleted?: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const remove = useDeleteGroup();

  return (
    <ConfirmDelete
      id={groupId}
      remove={remove}
      title={t('groups.deleteTitle')}
      text={t('groups.deleteText', { title })}
      action={t('groups.delete')}
      opened={opened}
      onClose={onClose}
      {...(onDeleted === undefined ? {} : { onDeleted })}
    />
  );
}
