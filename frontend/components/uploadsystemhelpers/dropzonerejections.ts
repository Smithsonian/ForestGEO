import type { FileRejection } from 'react-dropzone';

export interface RejectedFileMessage {
  fileName: string;
  reason: string;
}

/**
 * Turns react-dropzone rejections into one actionable line per file: the file name and why it
 * was refused. `acceptedFormats` (e.g. ".csv, .txt, .tsv") is appended so the reader knows what
 * to upload instead.
 */
export function describeRejections(rejections: FileRejection[], acceptedFormats: string): RejectedFileMessage[] {
  return rejections.map(({ file, errors }) => {
    const reasons = errors.map(error => {
      switch (error.code) {
        case 'file-invalid-type':
          return `unsupported file type. Accepted formats: ${acceptedFormats}`;
        case 'too-many-files':
          return 'too many files were dropped at once for this upload';
        case 'file-too-large':
          return error.message;
        default:
          return error.message;
      }
    });
    return { fileName: file.name, reason: reasons.join('; ') || `could not be accepted. Accepted formats: ${acceptedFormats}` };
  });
}
