import { describe, expect, it } from 'vitest';
import { extractCsvHeaderRow } from './csv-headers';

function fileOf(text: string, name = 'sample.csv'): File {
  return new File([text], name, { type: 'text/csv' });
}

describe('extractCsvHeaderRow (Papa-authoritative)', () => {
  it('strips surrounding quotes the custom tokenizer would have kept', async () => {
    expect(await extractCsvHeaderRow(fileOf('"tag","spcode"\n1,2\n'), ',')).toEqual(['tag', 'spcode']);
  });
  it('honors a quoted delimiter inside a header cell', async () => {
    expect(await extractCsvHeaderRow(fileOf('"tag,alias",spcode\n1,2\n'), ',')).toEqual(['tag,alias', 'spcode']);
  });
  it('honors a quoted newline inside a header cell', async () => {
    expect(await extractCsvHeaderRow(fileOf('"tag\nline2",spcode\n1,2\n'), ',')).toEqual(['tag\nline2', 'spcode']);
  });
  it('drops a leading BOM', async () => {
    expect(await extractCsvHeaderRow(fileOf('﻿tag,spcode\n1,2\n'), ',')).toEqual(['tag', 'spcode']);
  });
  it('preserves duplicate and blank header positions', async () => {
    expect(await extractCsvHeaderRow(fileOf('tag,,tag\n1,2,3\n'), ',')).toEqual(['tag', '', 'tag']);
  });
});
