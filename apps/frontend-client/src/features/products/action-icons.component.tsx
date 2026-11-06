import type { ReactElement } from 'react';

/** The paths of the small line icons of the actions; a dot is a circle of a radius of 1, drawn as two arcs. */
const iconPaths = {
  plus: 'M12 5v14M5 12h14',
  dots: [
    'M4 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0',
    'M11 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0',
    'M18 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0',
  ].join(''),
  arrowLeft: 'M19 12H5M11 18l-6-6 6-6',
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
  check: 'M5 12l5 5 9-10',
} as const;

export type LineIconNameType = keyof typeof iconPaths;

/** A small line icon of an action: it takes the colour of the text. */
export function LineIcon({
  name,
  size = 16,
}: {
  name: LineIconNameType;
  size?: number;
}): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={iconPaths[name]} />
    </svg>
  );
}
