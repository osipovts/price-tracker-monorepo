import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { ConfirmDelete } from './confirm-delete.component.js';
import { useDeleteProduct } from './use-products.hook.js';

/** Asks to confirm, and stops tracking the product for the user. */
export function DeleteProduct({
  productId,
  title,
  opened,
  onClose,
}: {
  productId: string;
  title: string;
  opened: boolean;
  onClose: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const remove = useDeleteProduct();

  return (
    <ConfirmDelete
      id={productId}
      remove={remove}
      title={t('product.deleteTitle')}
      text={t('product.deleteText', { title })}
      action={t('product.delete')}
      opened={opened}
      onClose={onClose}
    />
  );
}
