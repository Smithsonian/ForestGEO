/* eslint-disable class-methods-use-this */
export type ValidationError = {
  // For now using the index in the data array since there's no PK.
  // This must change if we can't guarantee the order of the array (e.g. sorting)
  index: number 
  column: string
  errorMessage: string
}

export type ValidationErrorSets = {
  preValidationErrors: Set<ValidationError>
  postValidationErrors: Set<ValidationError>
}

export class ValidationErrorMap extends Map<string, ValidationErrorSets> {
  getValidationErrors(index: number, column: string): Set<ValidationError> {
    const union = new Set<ValidationError>()

    const key = this.makeKey(index, column)
    const curr = this.get(key)
    if (curr) {
      curr.preValidationErrors.forEach(e => union.add(e))
      curr.postValidationErrors.forEach(e => union.add(e)) 
    }

    return union
  }

  addPreValidationErrors(index: number, column: string, errs: Set<ValidationError>) {
    const key = this.makeKey(index, column)
    const curr = this.get(key)
    if (curr) {
      curr.preValidationErrors = errs
      this.set(key, curr);
    } else {
      this.set(key, {
        preValidationErrors: errs,
        postValidationErrors: new Set<ValidationError>()
      })
    }
  }

  removePreValidationErrorsForCell(index: number, column: string) {
    const key = this.makeKey(index, column)
    const curr = this.get(key)
    if (curr) {
      curr.preValidationErrors.clear()
      this.set(key, curr)
    }
  }

  setPostValidationErrors(errs: Set<ValidationError>) {
    this.clearPostValidationErrors()

    errs.forEach(e => {
      this.addPostValidationError(e)  
    })
  }

  private makeKey(index: number, column: string) {
    return [index, column].join(',')
  }

  private clearPostValidationErrors() { 
    this.forEach((value , key) => {
      this.removePostValidationErrorsForCell(key)
    })
  }

  private removePostValidationErrorsForCell(key: string) {
    const curr = this.get(key)
    if (curr) {
      curr.postValidationErrors.clear()
      this.set(key, curr)
    }
  }

  private addPostValidationError(e: ValidationError) {
    const key = this.makeKey(e.index, e.column)
    const curr = this.get(key)
    if (curr) {
      curr.postValidationErrors.add(e)
      this.set(key, curr);
    } else {
      this.set(key, {
        preValidationErrors: new Set<ValidationError>(),
        postValidationErrors: new Set<ValidationError>([e])
      })
    }
  }
}