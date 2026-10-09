import {
  argbFromHex,
  DynamicColor,
  DynamicScheme,
  Hct,
  hexFromArgb,
  MaterialDynamicColors,
  SchemeFidelity,
  TonalPalette,
  Variant,
} from '@material/material-color-utilities';

/**
 * The Material 3 system colours Angular Material reads (`--mat-sys-<name>`), with the dynamic
 * colour that produces each.
 */
const SYSTEM_COLORS: ReadonlyArray<[string, DynamicColor]> = [
  ['primary', MaterialDynamicColors.primary],
  ['on-primary', MaterialDynamicColors.onPrimary],
  ['primary-container', MaterialDynamicColors.primaryContainer],
  ['on-primary-container', MaterialDynamicColors.onPrimaryContainer],
  ['primary-fixed', MaterialDynamicColors.primaryFixed],
  ['primary-fixed-dim', MaterialDynamicColors.primaryFixedDim],
  ['on-primary-fixed', MaterialDynamicColors.onPrimaryFixed],
  ['on-primary-fixed-variant', MaterialDynamicColors.onPrimaryFixedVariant],
  ['inverse-primary', MaterialDynamicColors.inversePrimary],
  ['secondary', MaterialDynamicColors.secondary],
  ['on-secondary', MaterialDynamicColors.onSecondary],
  ['secondary-container', MaterialDynamicColors.secondaryContainer],
  ['on-secondary-container', MaterialDynamicColors.onSecondaryContainer],
  ['secondary-fixed', MaterialDynamicColors.secondaryFixed],
  ['secondary-fixed-dim', MaterialDynamicColors.secondaryFixedDim],
  ['on-secondary-fixed', MaterialDynamicColors.onSecondaryFixed],
  ['on-secondary-fixed-variant', MaterialDynamicColors.onSecondaryFixedVariant],
  ['tertiary', MaterialDynamicColors.tertiary],
  ['on-tertiary', MaterialDynamicColors.onTertiary],
  ['tertiary-container', MaterialDynamicColors.tertiaryContainer],
  ['on-tertiary-container', MaterialDynamicColors.onTertiaryContainer],
  ['tertiary-fixed', MaterialDynamicColors.tertiaryFixed],
  ['tertiary-fixed-dim', MaterialDynamicColors.tertiaryFixedDim],
  ['on-tertiary-fixed', MaterialDynamicColors.onTertiaryFixed],
  ['on-tertiary-fixed-variant', MaterialDynamicColors.onTertiaryFixedVariant],
  ['error', MaterialDynamicColors.error],
  ['on-error', MaterialDynamicColors.onError],
  ['error-container', MaterialDynamicColors.errorContainer],
  ['on-error-container', MaterialDynamicColors.onErrorContainer],
  ['background', MaterialDynamicColors.background],
  ['on-background', MaterialDynamicColors.onBackground],
  ['surface', MaterialDynamicColors.surface],
  ['on-surface', MaterialDynamicColors.onSurface],
  ['surface-variant', MaterialDynamicColors.surfaceVariant],
  ['on-surface-variant', MaterialDynamicColors.onSurfaceVariant],
  ['surface-dim', MaterialDynamicColors.surfaceDim],
  ['surface-bright', MaterialDynamicColors.surfaceBright],
  ['surface-container-lowest', MaterialDynamicColors.surfaceContainerLowest],
  ['surface-container-low', MaterialDynamicColors.surfaceContainerLow],
  ['surface-container', MaterialDynamicColors.surfaceContainer],
  ['surface-container-high', MaterialDynamicColors.surfaceContainerHigh],
  ['surface-container-highest', MaterialDynamicColors.surfaceContainerHighest],
  ['surface-tint', MaterialDynamicColors.surfaceTint],
  ['inverse-surface', MaterialDynamicColors.inverseSurface],
  ['inverse-on-surface', MaterialDynamicColors.inverseOnSurface],
  ['outline', MaterialDynamicColors.outline],
  ['outline-variant', MaterialDynamicColors.outlineVariant],
  ['shadow', MaterialDynamicColors.shadow],
  ['scrim', MaterialDynamicColors.scrim],
];

export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/**
 * A fidelity scheme keeps the brand colour recognisable (a deep ITPO blue stays deep blue)
 * rather than softening it the way the default tonal-spot scheme does. An accent colour, when
 * given, replaces the tertiary palette.
 */
function scheme(primary: string, accent: string | null, isDark: boolean): DynamicScheme {
  const source = Hct.fromInt(argbFromHex(primary));
  const base = new SchemeFidelity(source, isDark, 0);
  if (!accent || !HEX_COLOR.test(accent)) {
    return base;
  }
  return new DynamicScheme({
    sourceColorHct: source,
    variant: Variant.FIDELITY,
    contrastLevel: 0,
    isDark,
    primaryPalette: base.primaryPalette,
    secondaryPalette: base.secondaryPalette,
    tertiaryPalette: TonalPalette.fromHct(Hct.fromInt(argbFromHex(accent))),
    neutralPalette: base.neutralPalette,
    neutralVariantPalette: base.neutralVariantPalette,
  });
}

/**
 * CSS custom properties for a brand: every Material system colour as `light-dark(light, dark)`,
 * so the page follows the device's light or dark preference with no extra work.
 */
export function brandColorVariables(
  primary: string,
  accent: string | null,
): Record<string, string> {
  const light = scheme(primary, accent, false);
  const dark = scheme(primary, accent, true);
  const variables: Record<string, string> = {};
  for (const [name, color] of SYSTEM_COLORS) {
    variables[`--mat-sys-${name}`] =
      `light-dark(${hexFromArgb(color.getArgb(light))}, ${hexFromArgb(color.getArgb(dark))})`;
  }
  return variables;
}
