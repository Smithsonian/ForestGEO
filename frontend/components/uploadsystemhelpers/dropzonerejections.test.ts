import { describe, expect, it } from 'vitest';
import type { FileRejection } from 'react-dropzone';
import { describeRejections } from './dropzonerejections';

const reject = (name: string, code: string, message = code): FileRejection => ({
  file: new File(['x'], name),
  errors: [{ code, message }]
});

describe('describeRejections', () => {
  it('names the file, the reason and the accepted formats for an unsupported type', () => {
    const [message] = describeRejections([reject('report.pdf', 'file-invalid-type')], '.csv, .txt, .tsv');
    expect(message.fileName).toBe('report.pdf');
    expect(message.reason).toContain('unsupported file type');
    expect(message.reason).toContain('.csv, .txt, .tsv');
  });

  it('lists every rejected file in a drop', () => {
    const messages = describeRejections([reject('a.pdf', 'file-invalid-type'), reject('b.xlsx', 'file-invalid-type')], '.csv, .txt, .tsv');
    expect(messages.map(m => m.fileName)).toEqual(['a.pdf', 'b.xlsx']);
  });

  it('passes through other dropzone messages such as size limits', () => {
    const [message] = describeRejections([reject('big.csv', 'file-too-large', 'File is too large (50 MB).')], '.csv');
    expect(message.reason).toBe('File is too large (50 MB).');
  });

  it('explains the single-file limit', () => {
    const [message] = describeRejections([reject('two.xlsx', 'too-many-files')], '.xlsx (ArcGIS workbook)');
    expect(message.reason).toContain('too many files');
  });
});
