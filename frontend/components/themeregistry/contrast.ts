/** WCAG 2.x relative luminance + contrast ratio, computed — never snapshotted. */
export function relativeLuminance(hex: string): number {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map(c => c + c)
          .join('')
      : clean;
  const [r, g, b] = [0, 2, 4].map(i => {
    const channel = parseInt(full.slice(i, i + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(foregroundHex: string, backgroundHex: string): number {
  const [lighter, darker] = [relativeLuminance(foregroundHex), relativeLuminance(backgroundHex)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

export const WCAG_AA_NORMAL_TEXT = 4.5;
export const PROJECT_DISABLED_FLOOR = 3.0;

export interface ContrastPair {
  label: string;
  foreground: string;
  background: string;
  minimum: number;
}
