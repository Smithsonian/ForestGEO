import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PlotCardModal from './plotcardmodal';
import type { PlotRDS } from '@/lib/db/definitions/zones';
import { HTTPResponses } from '@/config/macros';

const TEST_SITE = vi.hoisted(() => ({ schemaName: 'testschema', siteName: 'Test Site' }));
// Joy's ModalClose renders an unlabeled icon button; its root class is the stable hook.
const MODAL_CLOSE_SELECTOR = '.MuiModalClose-root';
const MODAL_BACKDROP_SELECTOR = '.MuiModal-backdrop';
const PLOT_NAME_PLACEHOLDER = 'Plot Name...';
const CREATE_PLOT_BUTTON_NAME = 'Create Plot';

vi.mock('@/app/contexts/compat-hooks', () => ({ useSiteContext: () => TEST_SITE }));

// The real module pulls in the view definitions, which the global test setup stubs out.
vi.mock('@/config/datagridhelpers', () => ({
  createPostPatchQuery: (schema: string, dataType: string, gridID: string) => `/api/fixeddata/${dataType}/${schema}/${gridID}`
}));

const storedPlot: PlotRDS = {
  plotID: 7,
  plotName: 'Alpha',
  dimensionX: 100,
  dimensionY: 50,
  area: 5000,
  globalX: 10,
  globalY: 20,
  globalZ: 0,
  globalCoordinatesEPSG: 26916,
  defaultDimensionUnits: 'm',
  defaultCoordinateUnits: 'm',
  defaultAreaUnits: 'm2',
  defaultDBHUnits: 'mm',
  defaultHOMUnits: 'm'
};

function renderModal(plot: PlotRDS = storedPlot) {
  const setOpen = vi.fn();
  const setManualReset = vi.fn();
  const utils = render(<PlotCardModal plot={plot} openPlotCardModal setOpenPlotCardModal={setOpen} setManualReset={setManualReset} />);
  return { ...utils, setOpen, setManualReset };
}

const nameInput = () => screen.getByPlaceholderText('Plot Name...') as HTMLInputElement;
const saveButton = () => screen.getByRole('button', { name: /Save Changes/ }) as HTMLButtonElement;
const edit = (placeholder: string, value: string) => fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value } });

describe('PlotCardModal', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('disables Save with an inline message for a blank name', () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    edit('Plot Name...', '   ');

    expect(screen.getByText('Plot name is required.')).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
  });

  it.each([
    ['X dimension...', '-5'],
    ['X dimension...', '0'],
    ['Y dimension...', 'abc'],
    ['Plot Area...', '0'],
    ['e.g. 26916', 'abc'],
    ['e.g. 26916', '0']
  ])('disables Save for invalid %s = %s', (placeholder, value) => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    edit(placeholder, value);

    expect(saveButton().disabled).toBe(true);
  });

  it('keeps Save enabled for EPSG 4326 and a negative coordinate', () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    edit('e.g. 26916', '4326');
    edit('X-coordinate...', '-81.5');

    expect(saveButton().disabled).toBe(false);
  });

  it('Cancel restores the stored values before leaving edit mode, and reopening edit starts clean', () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    edit('Plot Name...', '');
    edit('X dimension...', '-5');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(nameInput().value).toBe('Alpha');
    expect(nameInput().disabled).toBe(true);
    expect((screen.getByPlaceholderText('X dimension...') as HTMLInputElement).value).toBe('100.00');

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(nameInput().value).toBe('Alpha');
    expect((screen.getByPlaceholderText('X dimension...') as HTMLInputElement).value).toBe('100');
    expect(screen.queryByText('Plot name is required.')).toBeNull();
    expect(saveButton().disabled).toBe(false);
  });

  it('sends a trimmed name and a numeric EPSG on save', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    edit('Plot Name...', '  Beta  ');
    edit('e.g. 26916', '4326');

    fireEvent.click(saveButton());

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('testschema');
    expect(init.method).toBe('PATCH');
    const body = JSON.parse(init.body);
    expect(body.newRow.plotName).toBe('Beta');
    expect(body.newRow.globalCoordinatesEPSG).toBe(4326);
    expect(body.oldRow.plotName).toBe('Alpha');
  });

  it('keeps the modal in edit mode with the input intact after a failed save so it can be retried', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Duplicate plot name' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    const { setOpen } = renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    edit('Plot Name...', 'Beta');

    fireEvent.click(saveButton());
    await waitFor(() => expect(screen.getByText('Duplicate plot name')).toBeTruthy());

    expect(setOpen).not.toHaveBeenCalledWith(false);
    expect(nameInput().value).toBe('Beta');
    await waitFor(() => expect(saveButton().disabled).toBe(false));

    fireEvent.click(saveButton());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});

function renderCreatePlotModal() {
  const setOpenPlotCardModal = vi.fn();
  render(<PlotCardModal openPlotCardModal setOpenPlotCardModal={setOpenPlotCardModal} setManualReset={vi.fn()} />);
  return { setOpenPlotCardModal };
}

function modalCloseButton(): HTMLElement {
  const closeButton = document.querySelector<HTMLElement>(MODAL_CLOSE_SELECTOR);
  if (!closeButton) throw new Error(`[plotcardmodal test] no ${MODAL_CLOSE_SELECTOR} rendered`);
  return closeButton;
}

function modalBackdrop(): HTMLElement {
  const backdrop = document.querySelector<HTMLElement>(MODAL_BACKDROP_SELECTOR);
  if (!backdrop) throw new Error(`[plotcardmodal test] no ${MODAL_BACKDROP_SELECTOR} rendered`);
  return backdrop;
}

/** Starts a save whose fetch stays pending until the returned resolver runs. */
function startPendingSave(): () => void {
  let resolveSave: (response: Response) => void = () => undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<Response>(resolve => (resolveSave = resolve)))
  );
  fireEvent.change(screen.getByPlaceholderText(PLOT_NAME_PLACEHOLDER), { target: { value: 'Pending Plot' } });
  fireEvent.click(screen.getByRole('button', { name: CREATE_PLOT_BUTTON_NAME }));
  return () => resolveSave(new Response(JSON.stringify({}), { status: HTTPResponses.OK }));
}

describe('PlotCardModal dismissal (#524 item 2)', () => {
  let resolvePendingSave: (() => void) | null = null;

  beforeEach(() => {
    resolvePendingSave = null;
  });

  afterEach(() => {
    resolvePendingSave?.();
    vi.unstubAllGlobals();
  });

  it('closes on Escape when no save is in flight', () => {
    const { setOpenPlotCardModal } = renderCreatePlotModal();

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    console.log(`[plot modal idle Escape] setOpenPlotCardModal calls=${JSON.stringify(setOpenPlotCardModal.mock.calls)}`);

    expect(setOpenPlotCardModal).toHaveBeenCalledWith(false);
  });

  it('ignores a backdrop click so unsaved plot edits are not discarded', () => {
    const { setOpenPlotCardModal } = renderCreatePlotModal();
    const typedPlotName = 'Unsaved Plot';

    fireEvent.change(screen.getByPlaceholderText(PLOT_NAME_PLACEHOLDER), { target: { value: typedPlotName } });
    fireEvent.click(modalBackdrop());
    const plotNameAfterBackdropClick = (screen.getByPlaceholderText(PLOT_NAME_PLACEHOLDER) as HTMLInputElement).value;
    console.log(
      `[plot modal backdrop] setOpenPlotCardModal calls=${JSON.stringify(setOpenPlotCardModal.mock.calls)} plotName=${JSON.stringify(plotNameAfterBackdropClick)}`
    );

    expect(setOpenPlotCardModal, 'a stray backdrop click must not close the modal and drop the edits').not.toHaveBeenCalled();
    expect(plotNameAfterBackdropClick).toBe(typedPlotName);
  });

  it('closes from the X when no save is in flight, through one close path', () => {
    const { setOpenPlotCardModal } = renderCreatePlotModal();

    fireEvent.click(modalCloseButton());
    console.log(`[plot modal idle X] setOpenPlotCardModal calls=${JSON.stringify(setOpenPlotCardModal.mock.calls)}`);

    expect(setOpenPlotCardModal).toHaveBeenCalledTimes(1);
    expect(setOpenPlotCardModal).toHaveBeenCalledWith(false);
  });

  it('ignores Escape and the X while a save is pending', async () => {
    const { setOpenPlotCardModal } = renderCreatePlotModal();
    resolvePendingSave = startPendingSave();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    fireEvent.click(modalCloseButton());
    console.log(`[plot modal pending] setOpenPlotCardModal calls=${JSON.stringify(setOpenPlotCardModal.mock.calls)}`);

    expect(setOpenPlotCardModal, 'neither Escape nor the X may close the modal mid-save').not.toHaveBeenCalled();
  });
});
