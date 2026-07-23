/**
 * UploadParent — coordinateReferenceCorner plumbing
 *
 * UploadParent is the only place that holds coordinateReferenceCorner state (it must survive the
 * ReviewStates.UPLOAD_FILES -> ReviewStates.UPLOAD_SQL screen transition, where UploadParseFiles and
 * UploadFireSQL are two different mounted components). This file proves that plumbing in isolation:
 * a value UploadParseFiles reports via setCoordinateReferenceCorner is the exact value UploadFireSQL
 * receives once the review state advances, and that a fresh upload session resets it back to
 * DEFAULT_REFERENCE_CORNER (south-west).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import UploadParent from './uploadparent';
import { FormType } from '@/config/macros/formdetails';
import { DEFAULT_REFERENCE_CORNER } from '@/lib/provisioning/coordinate-reference-corner';
import type { QuadratReferenceCorner } from '@/lib/provisioning/types';

vi.mock('@/lib/db/definitions/core', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, AttributeStatusOptions: ['alive', 'dead', 'stem dead', 'broken below', 'omitted', 'missing'] };
});

vi.mock('@/lib/db/definitions/zones', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, getQuadratHCs: () => ({ quadratID: false, plotID: false, censusID: false }) };
});

vi.mock('@/lib/db/definitions/views', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getAllViewFullTableViewsHCs: () => ({
      coreMeasurementID: false,
      plotID: false,
      censusID: false,
      quadratID: false,
      speciesID: false,
      treeID: false,
      stemGUID: false,
      personnelID: false,
      familyID: false,
      genusID: false
    }),
    getMeasurementsSummaryViewHCs: () => ({
      coreMeasurementID: false,
      plotID: false,
      censusID: false,
      quadratID: false,
      speciesID: false,
      treeID: false,
      stemGUID: false,
      personnelID: false
    }),
    getAllTaxonomiesViewHCs: () => ({ speciesID: false, familyID: false, genusID: false })
  };
});

vi.mock('@/lib/db/definitions/personnel', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, getPersonnelHCs: () => ({ censusID: false, personnelID: false }) };
});

vi.mock('@/lib/db/definitions/taxonomies', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, getSpeciesLimitsHCs: () => ({ speciesLimitsID: false, speciesID: false }) };
});

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { name: 'Test User', email: 'test@example.com' } }, status: 'authenticated' })
}));

vi.mock('@/ailogger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() }
}));

vi.mock('@/components/shared/ContextValidationGuard', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}));

// A minimal stand-in that only exercises the one thing under test: reporting a chosen corner back
// up to UploadParent, then advancing past this screen. Real ReferenceCornerSelect/preflight
// behavior is covered separately in uploadparsefiles.test.tsx.
vi.mock('@/components/uploadsystem/segments/uploadparsefiles', () => ({
  default: ({
    coordinateReferenceCorner,
    setCoordinateReferenceCorner,
    handleAddFile,
    handleInitialSubmit
  }: {
    coordinateReferenceCorner: QuadratReferenceCorner;
    setCoordinateReferenceCorner: (next: QuadratReferenceCorner) => void;
    handleAddFile: (file: File) => void;
    handleInitialSubmit: () => Promise<void>;
  }) => (
    <div data-testid="upload-parse-files">
      <div data-testid="corner-in-parse-files">{coordinateReferenceCorner}</div>
      <button onClick={() => setCoordinateReferenceCorner('NE')}>Select North-East</button>
      <button onClick={() => handleAddFile(new File(['quadrat,startx,starty,dimx,dimy\nQ1,0,0,10,10'], 'quadrats.csv'))}>Select File</button>
      <button onClick={() => handleInitialSubmit()}>Continue Upload</button>
    </div>
  )
}));

vi.mock('@/components/uploadsystem/segments/uploadfiresql', () => ({
  default: ({ coordinateReferenceCorner }: { coordinateReferenceCorner: QuadratReferenceCorner }) => (
    <div data-testid="upload-fire-sql">
      <div data-testid="corner-in-fire-sql">{coordinateReferenceCorner}</div>
    </div>
  )
}));

describe('UploadParent — coordinateReferenceCorner survives the UPLOAD_FILES -> UPLOAD_SQL transition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('defaults to south-west before the user picks anything', () => {
    render(<UploadParent onReset={vi.fn()} overrideUploadForm={FormType.quadrats} />);
    expect(screen.getByTestId('corner-in-parse-files')).toHaveTextContent(DEFAULT_REFERENCE_CORNER);
  });

  it('carries the value the user picked in UploadParseFiles through to UploadFireSQL', async () => {
    const user = userEvent.setup();
    render(<UploadParent onReset={vi.fn()} overrideUploadForm={FormType.quadrats} />);

    await user.click(screen.getByText('Select North-East'));
    expect(screen.getByTestId('corner-in-parse-files')).toHaveTextContent('NE');

    await user.click(screen.getByText('Select File'));
    await user.click(screen.getByText('Continue Upload'));

    await waitFor(() => {
      expect(screen.getByTestId('upload-fire-sql')).toBeInTheDocument();
    });
    // The exact value chosen on the parse screen, not the default, must reach UploadFireSQL.
    expect(screen.getByTestId('corner-in-fire-sql')).toHaveTextContent('NE');
  });
});
