import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { FormType, SourceFormat } from '@/config/macros/formdetails';
import { UploadMode } from '@/config/uploadmodes';
import UploadParentModal from './uploadparentmodal';

// UploadParent pulls in the full upload pipeline (contexts, segments, SQL writers); this test is
// only about the mode-chooser screen UploadParentModal renders BEFORE UploadParent ever mounts, so
// replace it with a stand-in that exposes the props UploadParentModal passed it. That lets a test
// assert the real side effect of picking a mode (which overrideUploadMode UploadParent received),
// not just which chooser copy was on screen.
const receivedProps: { overrideUploadMode?: UploadMode; overrideSourceFormat?: SourceFormat }[] = [];
vi.mock('../uploadsystem/uploadparent', () => ({
  default: (props: { overrideUploadMode?: UploadMode; overrideSourceFormat?: SourceFormat }) => {
    receivedProps.push(props);
    return <div data-testid="upload-parent-stub">upload-parent:{props.overrideUploadMode}</div>;
  }
}));

// RenderGridFormExplanations is unrelated to the mode chooser and pulls in a large static header
// table; stub it so this file only has to reason about UploadParentModal's own markup.
vi.mock('@/components/client/rendergridformexplanations', () => ({
  default: () => null
}));

function renderModal(overrides: Partial<Parameters<typeof UploadParentModal>[0]> = {}) {
  const handleCloseUploadModal = vi.fn();
  const onUploadComplete = vi.fn();
  render(
    <UploadParentModal
      isUploadModalOpen
      handleCloseUploadModal={handleCloseUploadModal}
      formType={FormType.measurements}
      sourceFormat={SourceFormat.csv}
      onUploadComplete={onUploadComplete}
      {...overrides}
    />
  );
  return { handleCloseUploadModal, onUploadComplete };
}

describe('UploadParentModal mode chooser ordering (issue #504)', () => {
  it('lists Revisions before Clean Re-Upload for the CSV measurements mode chooser', () => {
    receivedProps.length = 0;
    renderModal({ formType: FormType.measurements, sourceFormat: SourceFormat.csv });

    const buttonLabels = screen.getAllByRole('button').map(b => b.textContent);
    const revisionsIndex = buttonLabels.findIndex(label => label === 'Use Revisions Upload');
    const cleanReuploadIndex = buttonLabels.findIndex(label => label === 'Use Clean Re-Upload');

    expect(revisionsIndex).toBeGreaterThanOrEqual(0);
    expect(cleanReuploadIndex).toBeGreaterThanOrEqual(0);
    expect(revisionsIndex).toBeLessThan(cleanReuploadIndex);

    // UploadParent must not have mounted yet -- the user has not picked a mode.
    expect(screen.queryByTestId('upload-parent-stub')).toBeNull();
    expect(receivedProps).toHaveLength(0);
  });

  it('lists Revisions before Clean Re-Upload for non-measurement CSV forms too (e.g. species)', () => {
    receivedProps.length = 0;
    renderModal({ formType: FormType.species, sourceFormat: SourceFormat.csv });

    const buttonLabels = screen.getAllByRole('button').map(b => b.textContent);
    const revisionsIndex = buttonLabels.findIndex(label => label === 'Use Revisions Upload');
    const cleanReuploadIndex = buttonLabels.findIndex(label => label === 'Use Clean Re-Upload');

    expect(revisionsIndex).toBeGreaterThanOrEqual(0);
    expect(cleanReuploadIndex).toBeGreaterThanOrEqual(0);
    expect(revisionsIndex).toBeLessThan(cleanReuploadIndex);
  });

  it('selecting Revisions mounts UploadParent with UploadMode.REVISIONS (actual side effect, not just copy)', () => {
    receivedProps.length = 0;
    renderModal({ formType: FormType.measurements, sourceFormat: SourceFormat.csv });

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Use Revisions Upload' }));
    });

    expect(receivedProps).toHaveLength(1);
    expect(receivedProps[0].overrideUploadMode).toBe(UploadMode.REVISIONS);
    expect(screen.getByTestId('upload-parent-stub')).toHaveTextContent(`upload-parent:${UploadMode.REVISIONS}`);
  });

  it('selecting Clean Re-Upload mounts UploadParent with UploadMode.CLEAN_REUPLOAD', () => {
    receivedProps.length = 0;
    renderModal({ formType: FormType.measurements, sourceFormat: SourceFormat.csv });

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Use Clean Re-Upload' }));
    });

    expect(receivedProps).toHaveLength(1);
    expect(receivedProps[0].overrideUploadMode).toBe(UploadMode.CLEAN_REUPLOAD);
  });
});

describe('UploadParentModal ArcGIS mode (unchanged by the reorder)', () => {
  it('offers only Clean Re-Upload for ArcGIS workbooks -- no Revisions option at all', () => {
    receivedProps.length = 0;
    renderModal({ formType: FormType.measurements, sourceFormat: SourceFormat.arcgis_xlsx });

    expect(screen.getByText('Confirm Import Mode')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Use Revisions Upload' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Use Clean Re-Upload' })).toBeDefined();
  });

  it('ArcGIS Clean Re-Upload still mounts UploadParent with the arcgis_xlsx source format', () => {
    receivedProps.length = 0;
    renderModal({ formType: FormType.measurements, sourceFormat: SourceFormat.arcgis_xlsx });

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Use Clean Re-Upload' }));
    });

    expect(receivedProps).toHaveLength(1);
    expect(receivedProps[0].overrideUploadMode).toBe(UploadMode.CLEAN_REUPLOAD);
    expect(receivedProps[0].overrideSourceFormat).toBe(SourceFormat.arcgis_xlsx);
  });
});

describe('UploadParentModal Revisions description (#525 item 5)', () => {
  const MEASUREMENTS_REVISION_DESCRIPTION =
    'Updates measurements matched by the Stem ID column from a ForestGEO export (or, if the file has no Stem IDs, by Tree Tag + Stem Tag, case-insensitive) and adds any new rows from the file.';
  const SPECIES_REVISION_DESCRIPTION = 'Updates existing records matched by SpeciesCode (case-insensitive) and adds any new rows from the file.';

  it('describes measurement matching by the Stem ID column of an export or Tree Tag + Stem Tag, never by StemGUID', () => {
    renderModal({ formType: FormType.measurements, sourceFormat: SourceFormat.csv });
    const dialogText = document.body.textContent ?? '';
    console.log(`[#525 item 5] measurements chooser mentions StemGUID: ${dialogText.includes('StemGUID')}`);

    expect(screen.getByText(MEASUREMENTS_REVISION_DESCRIPTION)).toBeInTheDocument();
    expect(dialogText).not.toContain('StemGUID');
  });

  it('keeps the species sentence exactly as it was', () => {
    renderModal({ formType: FormType.species, sourceFormat: SourceFormat.csv });
    expect(screen.getByText(SPECIES_REVISION_DESCRIPTION)).toBeInTheDocument();
  });
});
