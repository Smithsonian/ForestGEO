import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PlotCardModal from './plotcardmodal';
import { HTTPResponses } from '@/config/macros';

const PLOT_SAVE_ENDPOINT = '/api/fixeddata/plots/testschema/plotID';
const TEST_SITE = vi.hoisted(() => ({ schemaName: 'testschema', siteName: 'Test Site' }));
// Joy's ModalClose renders an unlabeled icon button; its root class is the stable hook.
const MODAL_CLOSE_SELECTOR = '.MuiModalClose-root';
const MODAL_BACKDROP_SELECTOR = '.MuiModal-backdrop';
const PLOT_NAME_PLACEHOLDER = 'Plot Name...';
const CREATE_PLOT_BUTTON_NAME = 'Create Plot';

vi.mock('@/app/contexts/compat-hooks', () => ({ useSiteContext: () => TEST_SITE }));
vi.mock('@/config/datagridhelpers', () => ({ createPostPatchQuery: () => PLOT_SAVE_ENDPOINT }));

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
