export function preValidate(value: any): string[] { 
  const errorMessages: string[] = []

  if (parseInt(value, 10) === 1337) {
    errorMessages.push("Oops! That value is too cool to be true!");
  }

  return errorMessages
}