import { Group, VisuallyHidden } from '@mantine/core';
import { useLocale } from 'frontend-shared';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { LineIcon, type LineIconNameType } from './action-icons.component.js';
import { describePriceChecks, type PriceChecksInterface } from './price-checks.type.js';

/** The read the line is about is fainter than the one to come: the one to come is what the person waits for. */
const pastOpacity = 0.7;

/** An icon and a time; what the time is of is told by the hint, and to a screen reader by hidden words. */
function CheckTime({
  icon,
  label,
  time,
  faint,
}: {
  icon: LineIconNameType;
  label: string;
  time: string;
  faint: boolean;
}): ReactElement {
  return (
    <Group
      component="span"
      gap={4}
      wrap="nowrap"
      title={label}
      {...(faint ? { opacity: pastOpacity } : {})}
    >
      <LineIcon name={icon} size={12} />
      <VisuallyHidden>{label}</VisuallyHidden>
      {time}
    </Group>
  );
}

/** The quiet line under a name: a tick and when the price was read, an arrow and when it is read again. */
export function PriceChecks({ checks }: { checks: PriceChecksInterface }): ReactElement | null {
  const { t } = useTranslation();
  const locale = useLocale();
  const { checked, next } = describePriceChecks(checks, t, locale, new Date());

  if (checked === null && next === null) return null;

  return (
    <Group gap="sm" wrap="nowrap" fz="xs" lh="xs" c="dimmed">
      {checked !== null && (
        <CheckTime icon="check" label={t('product.checked')} time={checked} faint />
      )}
      {next !== null && (
        <CheckTime icon="arrowRight" label={t('product.nextCheck')} time={next} faint={false} />
      )}
    </Group>
  );
}
