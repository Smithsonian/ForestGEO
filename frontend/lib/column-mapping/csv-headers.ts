import Papa from 'papaparse';

/**
 * The single authoritative way to read a CSV's header row. Uses Papa Parse with `header:false`
 * and `preview:1` and the SAME delimiter the upload will use, so the header sequence that seeds a
 * mapping is byte-for-byte the sequence the upload's `Papa.parse` will key rows against. Returns
 * the header cells, trimmed (Papa already strips quotes, honors quoted newlines, and drops the BOM).
 */
export function extractCsvHeaderRow(file: File, delimiter: string): Promise<string[]> {
  return new Promise<string[]>((resolve, reject) => {
    Papa.parse<string[]>(file, {
      delimiter,
      header: false,
      preview: 1,
      skipEmptyLines: true,
      complete: results => resolve((results.data[0] ?? []).map(h => (h ?? '').trim())),
      error: (error: Error) => reject(error)
    });
  });
}
