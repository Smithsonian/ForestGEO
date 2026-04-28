// MUI X DataGrid rejects the row-update promise with new Error('cancelled') when the
// user dismisses an edit (e.g. presses Escape). The string is part of the library's
// runtime contract and is not exported as a constant or error type.
export const MUI_ROW_EDIT_CANCELLED_MESSAGE = 'cancelled';

export function isMuiRowEditCancelled(error: unknown): boolean {
  return error instanceof Error && error.message === MUI_ROW_EDIT_CANCELLED_MESSAGE;
}
