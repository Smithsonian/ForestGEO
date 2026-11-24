/** The server refused an upload for a reason the uploader can act on. Its message is written for them and is safe to return. */
export class UploadRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UploadRefusedError';
  }
}
