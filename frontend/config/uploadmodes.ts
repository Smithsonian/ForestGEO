export enum UploadMode {
  CLEAN_REUPLOAD = 'clean_reupload',
  REVISIONS = 'revisions'
}

export const UploadModeLabels: Record<UploadMode, string> = {
  [UploadMode.CLEAN_REUPLOAD]: 'Clean Re-Upload',
  [UploadMode.REVISIONS]: 'Revisions Upload'
};

export function normalizeUploadMode(value: unknown): UploadMode {
  return value === UploadMode.REVISIONS ? UploadMode.REVISIONS : UploadMode.CLEAN_REUPLOAD;
}
