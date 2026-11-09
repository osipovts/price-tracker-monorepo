export type AlarmColorType = 'red' | 'orange';

/** The colour of a figure that calls for attention, as props to spread; none for a figure that does not. */
export function alarmColor(
  alarm: boolean,
  color: AlarmColorType,
): { c: AlarmColorType } | Record<string, never> {
  return alarm ? { c: color } : {};
}
