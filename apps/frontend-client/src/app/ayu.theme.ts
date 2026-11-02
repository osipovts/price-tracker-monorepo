import {
  createTheme,
  type CSSVariablesResolver,
  type MantineColorsTuple,
  type MantineThemeOverride,
  virtualColor,
} from '@mantine/core';

/** The font of the name of the app. */
export const BRAND_FONT = "'Great Vibes', cursive";

/** Ayu Light: the greys of the page and its lines. */
const gray: MantineColorsTuple = [
  '#f3f4f5',
  '#eff0f1',
  '#e7e8e9',
  '#d9dadc',
  '#bfc1c4',
  '#a6a9ad',
  '#8a9199',
  '#6c7680',
  '#5c6166',
  '#3f4348',
];

/** Ayu Dark: from the text (0) to the page (7) and below. */
const dark: MantineColorsTuple = [
  '#bfbdb6',
  '#acaaa3',
  '#8a8f98',
  '#626a73',
  '#2d3340',
  '#222834',
  '#131721',
  '#0b0e14',
  '#080a0f',
  '#05070a',
];

/** The accent of both schemes: Ayu Dark blue (shade 5) and Ayu Light blue (shade 6). */
const ayu: MantineColorsTuple = [
  '#e8f6ff',
  '#cfeeff',
  '#a8e0ff',
  '#82d2ff',
  '#6ccaff',
  '#59c2ff',
  '#399ee6',
  '#2f87c7',
  '#2670a8',
  '#1d5a89',
];

export const ayuTheme: MantineThemeOverride = createTheme({
  colors: {
    gray,
    dark,
    ayu,
    // The same colours in both schemes, but virtual: the text on them is chosen for each scheme by its own
    // shade, where a plain colour gets the one of the light scheme in both.
    accent: virtualColor({ name: 'accent', light: 'ayu', dark: 'ayu' }),
    success: virtualColor({ name: 'success', light: 'green', dark: 'green' }),
  },
  fontFamily: 'Roboto, sans-serif',
  primaryColor: 'accent',
  primaryShade: { light: 6, dark: 5 },
  autoContrast: true,
  // Above the blue and the green of the light scheme (0.31 and 0.39), below those of the dark one (0.47 and up):
  // white text on the filled buttons and badges of the light scheme, dark text on those of the dark one.
  luminanceThreshold: 0.42,
});

/** The page and its text in the two schemes of Ayu. */
export const ayuVariables: CSSVariablesResolver = () => ({
  variables: {},
  light: { '--mantine-color-body': '#fcfcfc', '--mantine-color-text': '#5c6166' },
  dark: { '--mantine-color-body': '#0b0e14', '--mantine-color-text': '#bfbdb6' },
});
