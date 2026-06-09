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
    const { rerender } = render(
      <ColumnMappingDialog open format={SourceFormat.csv} metadata={meta} mapping={initial} onChange={() => {}} onApply={onApply} onClose={() => {}} />
    );
    const apply = screen.getByRole('button', { name: /apply mapping/i });
    expect(apply).toBeDisabled();

    // Simulate a fully-resolved mapping passed back in via props
    const resolvedMeta: CsvSourceMetadata = { format: SourceFormat.csv, headers: ['tag', 'spcode', 'quadrat', 'X_Coord', 'Y_Coord', 'date'] };
    const resolved = seedMapping(resolvedMeta);
    rerender(
      <ColumnMappingDialog open format={SourceFormat.csv} metadata={resolvedMeta} mapping={resolved} onChange={() => {}} onApply={onApply} onClose={() => {}} />
    );
    const apply2 = screen.getByRole('button', { name: /apply mapping/i });
    expect(apply2).toBeEnabled();
    fireEvent.click(apply2);
    expect(onApply).toHaveBeenCalledWith(resolved);
  });

  it('shows a required badge for tag and optional for comments', () => {
    render(
      <ColumnMappingDialog
        open
        format={SourceFormat.csv}
        metadata={meta}
        mapping={seedMapping(meta)}
        onChange={() => {}}
        onApply={() => {}}
        onClose={() => {}}
      />
    );
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
    render(
      <ColumnMappingDialog
        open
        format={SourceFormat.csv}
        metadata={resolvedMeta}
        mapping={duplicated}
        onChange={() => {}}
        onApply={() => {}}
        onClose={() => {}}
      />
    );
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
        onChange={() => {}}
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
        onChange={() => {}}
        onApply={() => {}}
        onClose={() => {}}
      />
    );
    expect(screen.getByText(/File: survey_data\.csv/)).toBeInTheDocument();
  });

  it('does not render a file name line when the fileName prop is omitted', () => {
    render(
      <ColumnMappingDialog
        open
        format={SourceFormat.csv}
        metadata={meta}
        mapping={seedMapping(meta)}
        onChange={() => {}}
        onApply={() => {}}
        onClose={() => {}}
      />
    );
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
        onChange={() => {}}
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
        onChange={() => {}}
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
        onChange={() => {}}
        onApply={() => {}}
        onClose={() => {}}
      />
    );
    expect(screen.getByText(/different sheets/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /apply mapping/i })).toBeDisabled();
  });
});
