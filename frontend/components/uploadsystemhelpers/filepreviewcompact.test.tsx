import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import FilePreviewCompact from './filepreviewcompact';
import { clearAllCaches } from './delimiterdetection';

const PERMITTED_HEADERS = ['plotname', 'censusnumber', 'quadrat', 'tag', 'stemtag', 'spcode'];
const REQUIRED_HEADERS = ['tag', 'spcode'];

function csv(text: string, name: string): File {
  return new File([text], name, { type: 'text/csv' });
}

describe('FilePreviewCompact column count feedback', () => {
  beforeEach(() => {
    clearAllCaches();
  });

  it('shows no count-mismatch warning on a valid file whose columns are fewer than every permitted field', async () => {
    render(
      <FilePreviewCompact
        file={csv('tag,spcode\n1,ACAL\n2,ACBE\n', 'valid.csv')}
        expectedHeaders={PERMITTED_HEADERS}
        validationHeaders={REQUIRED_HEADERS}
        onDelimiterChange={vi.fn()}
        initialDelimiter=","
      />
    );

    await waitFor(() => expect(screen.getByText('Valid')).toBeTruthy());
    expect(screen.queryByText(/count mismatch/i)).toBeNull();
    expect(screen.getByText('Detected:').parentElement?.textContent).toContain('2 columns');
  });

  it('still surfaces missing required headers as an issue', async () => {
    render(
      <FilePreviewCompact
        file={csv('tag,family\n1,Euph\n', 'missing.csv')}
        expectedHeaders={PERMITTED_HEADERS}
        validationHeaders={REQUIRED_HEADERS}
        onDelimiterChange={vi.fn()}
        initialDelimiter=","
      />
    );

    await waitFor(() => expect(screen.getByText('Issues detected')).toBeTruthy());
    expect(screen.getByText(/Missing required columns: Spcode/)).toBeTruthy();
    expect(screen.queryByText(/count mismatch/i)).toBeNull();
  });

  it('still surfaces a ragged row with its physical source line', async () => {
    render(
      <FilePreviewCompact
        file={csv('tag,spcode\n1,ACAL\n2\n', 'ragged.csv')}
        expectedHeaders={PERMITTED_HEADERS}
        validationHeaders={REQUIRED_HEADERS}
        onDelimiterChange={vi.fn()}
        initialDelimiter=","
      />
    );

    await waitFor(() => expect(screen.getByText('Issues detected')).toBeTruthy());
    expect(screen.getByText(/Line 3 has 1 columns, expected 2/)).toBeTruthy();
    expect(screen.queryByText(/data row/i)).toBeNull();
  });
});
