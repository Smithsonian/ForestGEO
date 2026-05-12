import type { ProvisioningInput, QuadratCsvRow, QuadratGridConfig } from './types';

const SEQUENTIAL_PAD_WIDTH = 4;

export function generateGrid(plot: ProvisioningInput['plot'], config: QuadratGridConfig): QuadratCsvRow[] {
  const cols = plot.dimensionX / config.quadratSizeX;
  const rows = plot.dimensionY / config.quadratSizeY;
  if (!Number.isInteger(cols) || !Number.isInteger(rows)) {
    throw new Error(`Plot dimensions (${plot.dimensionX}x${plot.dimensionY}) not divisible by quadrat size (${config.quadratSizeX}x${config.quadratSizeY})`);
  }
  const out: QuadratCsvRow[] = [];
  let seq = 1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const name = config.namingPattern === 'sequential' ? `Q${String(seq).padStart(SEQUENTIAL_PAD_WIDTH, '0')}` : `${r + 1}-${c + 1}`;
      out.push({
        quadratName: name,
        startX: c * config.quadratSizeX,
        startY: r * config.quadratSizeY,
        dimensionX: config.quadratSizeX,
        dimensionY: config.quadratSizeY
      });
      seq++;
    }
  }
  return out;
}
