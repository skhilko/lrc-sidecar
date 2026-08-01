export class UsageError extends Error {
  readonly exitCode = 2;
}

export class FatalError extends Error {
  readonly exitCode: 3 | 4;

  constructor(message: string, exitCode: 3 | 4 = 3, options?: ErrorOptions) {
    super(message, options);
    this.exitCode = exitCode;
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function sanitizeMessage(message: string, maxLength = 300): string {
  return message.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}
