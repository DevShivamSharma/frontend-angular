import Aura from '@primeuix/themes/aura';
import { definePreset } from '@primeuix/themes';

/**
 * PrimeNG's Aura with ITPO's red as the primary colour. 600 is the one used for filled controls:
 * white text on it keeps a contrast ratio above 4.5:1.
 */
export const AppPreset = definePreset(Aura, {
  semantic: {
    primary: {
      50: '#fdf2f3',
      100: '#fce7e9',
      200: '#f9d0d5',
      300: '#f4a9b2',
      400: '#ec7686',
      500: '#df4a60',
      600: '#c8283f',
      700: '#a81f33',
      800: '#8c1d30',
      900: '#771d2e',
      950: '#420c15',
    },
    colorScheme: {
      light: {
        primary: {
          color: '{primary.600}',
          hoverColor: '{primary.700}',
          activeColor: '{primary.800}',
        },
      },
      dark: {
        primary: {
          color: '{primary.400}',
          hoverColor: '{primary.300}',
          activeColor: '{primary.200}',
        },
      },
    },
  },
});
