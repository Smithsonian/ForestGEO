import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { SourceFormat } from '@/config/macros/formdetails';
import ColumnMappingDialog from './columnmappingdialog';
import { seedMapping } from '@/lib/column-mapping/mapping';
import { ArcgisSourceMetadata, CsvSourceMetadata } from '@/lib/column-mapping/types';

const meta: CsvSourceMetadata = { format: SourceFormat.csv, headers: ['X_Coord', 'Y_Coord', 'Sp', 'Q20', 'date', 'TreeNo'] };

describe('ColumnMappingDialog (csv)', () => {
  it('disables Apply until required fields are mapped, then enables and applies', () => {
    const onApply = vi.fn();
    // seedMapping leaves tag/quadrat unmapped here (TreeNo/Q20 are not aliases)
    const initial = seedMapping(meta);
    const { rerender } = render(<ColumnMappingDialog open format={SourceFormat.csv} metadata={meta} mapping={initial} onApply={onApply} onClose={() => {}} />);
    const apply = screen.getByRole('button', { name: /apply mapping/i });
    expect(apply).toBeDisabled();

    // Simulate a fully-resolved mapping passed back in via props; the header signature differs,
    // so the dialog reseeds its draft from the new mapping prop.
    const resolvedMeta: CsvSourceMetadata = { format: SourceFormat.csv, headers: ['tag', 'spcode', 'quadrat', 'X_Coord', 'Y_Coord', 'date'] };
    const resolved = seedMapping(resolvedMeta);
    rerender(<ColumnMappingDialog open format={SourceFormat.csv} metadata={resolvedMeta} mapping={resolved} onApply={onApply} onClose={() => {}} />);
    const apply2 = screen.getByRole('button', { name: /apply mapping/i });
    expect(apply2).toBeEnabled();
    fireEvent.click(apply2);
    expect(onApply).toHaveBeenCalledWith(resolved);
  });

  it('shows a required badge for tag and optional for comments', () => {
    render(<ColumnMappingDialog open format={SourceFormat.csv} metadata={meta} mapping={seedMapping(meta)} onApply={() => {}} onClose={() => {}} />);
    const tagRow = screen.getByTestId('mapping-row-tag');
    expect(within(tagRow).getByText(/required/i)).toBeInTheDocument();
    const commentsRow = screen.getByTestId('mapping-row-comments');
    expect(within(commentsRow).getByText(/optional/i)).toBeInTheDocument();
  });
});

describe('ColumnMappingDialog validation messages', () => {
  it('flags a column mapped to two fields and disables Apply', () => {
    const resolvedMeta: CsvSourceMetadata = { format: SourceFormat.csv, headers: ['tag', 'spcode', 'quadrat', 'X_Coord', 'Y_Coord', 'date'] };
    const seeded = seedMapping(resolvedMeta);
    const duplicated = {
      ...seeded,
      fields: seeded.fields.map(f => (f.canonicalField === 'ly' ? { ...f, sourceColumns: ['X_Coord'] } : f))
    };
    render(<ColumnMappingDialog open format={SourceFormat.csv} metadata={resolvedMeta} mapping={duplicated} onApply={() => {}} onClose={() => {}} />);
    expect(screen.getByText(/mapped to more than one field/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /apply mapping/i })).toBeDisabled();
  });

  it('renders a server-side rejection so a failed re-preflight is explained', () => {
    render(
      <ColumnMappingDialog
        open
        format={SourceFormat.csv}
        metadata={meta}
        mapping={seedMapping(meta)}
        onApply={() => {}}
        onClose={() => {}}
        serverError={'Trees sheet "Sheet1" is missing required column(s): lx.'}
      />
    );
    expect(screen.getByText(/Trees sheet "Sheet1" is missing required column\(s\): lx\./)).toBeInTheDocument();
  });
});

describe('ColumnMappingDialog fileName prop', () => {
  it('renders the file name under the title when the fileName prop is set', () => {
    render(
      <ColumnMappingDialog
        open
        format={SourceFormat.csv}
        fileName="survey_data.csv"
        metadata={meta}
        mapping={seedMapping(meta)}
        onApply={() => {}}
        onClose={() => {}}
      />
    );
    expect(screen.getByText(/File: survey_data\.csv/)).toBeInTheDocument();
  });

  it('does not render a file name line when the fileName prop is omitted', () => {
    render(<ColumnMappingDialog open format={SourceFormat.csv} metadata={meta} mapping={seedMapping(meta)} onApply={() => {}} onClose={() => {}} />);
    expect(screen.queryByText(/^File:/)).not.toBeInTheDocument();
  });
});

describe('ColumnMappingDialog (arcgis sheet roles)', () => {
  it('renders trees/stems sheet-role selects when no sheets were detected', () => {
    const arcgisMeta: ArcgisSourceMetadata = {
      format: SourceFormat.arcgis_xlsx,
      sheets: [
        { name: 'TreesCustom', columns: ['GlobalID', 'TreeTag', 'MyX', 'MyY'] },
        { name: 'StemsCustom', columns: ['GlobalID', 'ParentGlobalID'] }
      ]
    };
    render(
      <ColumnMappingDialog
        open
        format={SourceFormat.arcgis_xlsx}
        metadata={arcgisMeta}
        mapping={seedMapping(arcgisMeta)}
        onApply={() => {}}
        onClose={() => {}}
      />
    );
    expect(screen.getByText('Sheet roles')).toBeInTheDocument();
    expect(screen.getByText(/select trees sheet/i)).toBeInTheDocument();
    expect(screen.getByText(/select stems sheet/i)).toBeInTheDocument();
  });

  it('keeps the sheet-role selects visible after both roles are set so the user can change them', () => {
    const arcgisMeta: ArcgisSourceMetadata = {
      format: SourceFormat.arcgis_xlsx,
      sheets: [
        { name: 'TreesCustom', columns: ['GlobalID', 'TreeTag', 'MyX', 'MyY'] },
        { name: 'StemsCustom', columns: ['GlobalID', 'ParentGlobalID'] }
      ],
      detectedTreesSheet: 'TreesCustom',
      detectedStemsSheet: 'StemsCustom'
    };
    render(
      <ColumnMappingDialog
        open
        format={SourceFormat.arcgis_xlsx}
        metadata={arcgisMeta}
        mapping={seedMapping(arcgisMeta)}
        onApply={() => {}}
        onClose={() => {}}
      />
    );
    expect(screen.getByText('Sheet roles')).toBeInTheDocument();
  });

  it('explains when both roles point at the same sheet and disables Apply', () => {
    const arcgisMeta: ArcgisSourceMetadata = {
      format: SourceFormat.arcgis_xlsx,
      sheets: [
        { name: 'Sheet1', columns: ['GlobalID', 'tag', 'StemTag', 'spcode', 'quadrat', 'lx', 'ly', 'Date_measured', 'ParentGlobalID'] },
        { name: 'Sheet2', columns: ['GlobalID', 'ParentGlobalID', 'tag', 'StemTag', 'spcode', 'quadrat', 'Date_measured'] }
      ],
      detectedTreesSheet: 'Sheet1',
      detectedStemsSheet: 'Sheet1'
    };
    render(
      <ColumnMappingDialog
        open
        format={SourceFormat.arcgis_xlsx}
        metadata={arcgisMeta}
        mapping={seedMapping(arcgisMeta)}
        onApply={() => {}}
        onClose={() => {}}
      />
    );
    expect(screen.getByText(/different sheets/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /apply mapping/i })).toBeDisabled();
  });
});

describe('ColumnMappingDialog draft isolation', () => {
  // Seed leaves NOTHING unmapped, so Apply starts enabled and we can prove a local edit changes
  // Apply-enabled state WITHOUT escaping to the parent.
  const fullyResolvedMeta: CsvSourceMetadata = {
    format: SourceFormat.csv,
    headers: ['tag', 'spcode', 'quadrat', 'lx', 'ly', 'dbh', 'hom', 'date']
  };

  function openOption(row: HTMLElement, optionText: RegExp | string) {
    // Joy Select's trigger button opens its listbox on click (not mousedown).
    fireEvent.click(within(row).getByRole('combobox'));
    fireEvent.click(screen.getByRole('option', { name: optionText }));
  }

  it('does not commit edits to the parent until Apply is clicked', () => {
    const onApply = vi.fn();
    const seeded = seedMapping(fullyResolvedMeta);
    render(<ColumnMappingDialog open format={SourceFormat.csv} metadata={fullyResolvedMeta} mapping={seeded} onApply={onApply} onClose={() => {}} />);
    const tagRow = screen.getByTestId('mapping-row-tag');
    openOption(tagRow, /^lx$/i); // pick a wrong column for tag → draft invalid
    expect(screen.getByRole('button', { name: /apply mapping/i })).toBeDisabled();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('discards the draft on Cancel', () => {
    const onApply = vi.fn();
    const onClose = vi.fn();
    const seeded = seedMapping(fullyResolvedMeta);
    const { rerender } = render(
      <ColumnMappingDialog open format={SourceFormat.csv} metadata={fullyResolvedMeta} mapping={seeded} onApply={onApply} onClose={onClose} />
    );
    const tagRow = screen.getByTestId('mapping-row-tag');
    openOption(tagRow, /^lx$/i); // bad edit: seeded-valid mapping becomes invalid
    expect(screen.getByRole('button', { name: /apply mapping/i })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();

    // Reopen with the SAME props (same file/signature). Closing must have nulled the seed key,
    // so the dialog reseeds from the prop and the bad edit is gone → Apply is enabled again.
    rerender(<ColumnMappingDialog open={false} format={SourceFormat.csv} metadata={fullyResolvedMeta} mapping={seeded} onApply={onApply} onClose={onClose} />);
    rerender(<ColumnMappingDialog open format={SourceFormat.csv} metadata={fullyResolvedMeta} mapping={seeded} onApply={onApply} onClose={onClose} />);
    expect(screen.getByRole('button', { name: /apply mapping/i })).toBeEnabled();
  });

  it('commits exactly the draft (the seed) on Apply when unchanged', () => {
    const onApply = vi.fn();
    const seeded = seedMapping(fullyResolvedMeta);
    render(<ColumnMappingDialog open format={SourceFormat.csv} metadata={fullyResolvedMeta} mapping={seeded} onApply={onApply} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /apply mapping/i }));
    expect(onApply).toHaveBeenCalledTimes(1);
    const committed = onApply.mock.calls[0][0];
    expect(committed.fields.find((f: { canonicalField: string }) => f.canonicalField === 'tag')?.sourceColumns).toEqual(['tag']);
  });

  it('reseeds the draft when reopened for a different file (new signature)', () => {
    const onApply = vi.fn();
    const first = seedMapping(fullyResolvedMeta);
    const { rerender } = render(
      <ColumnMappingDialog open format={SourceFormat.csv} fileName="a.csv" metadata={fullyResolvedMeta} mapping={first} onApply={onApply} onClose={() => {}} />
    );
    const otherMeta: CsvSourceMetadata = { format: SourceFormat.csv, headers: ['TreeNo', 'Sp', 'Q', 'date'] };
    const second = seedMapping(otherMeta);
    rerender(
      <ColumnMappingDialog open format={SourceFormat.csv} fileName="b.csv" metadata={otherMeta} mapping={second} onApply={onApply} onClose={() => {}} />
    );
    // Different file → seed has unmapped required fields → Apply disabled, proving reseed happened.
    expect(screen.getByRole('button', { name: /apply mapping/i })).toBeDisabled();
  });
});
