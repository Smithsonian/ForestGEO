export class MissingSheetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MissingSheetError';
  }
}

export class MissingColumnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MissingColumnError';
  }
}

export class AmbiguousSheetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AmbiguousSheetError';
  }
}

export class UnparseableDateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnparseableDateError';
  }
}
