/** Base class for all SDK-level errors. Provides a stable `code` and HTTP `statusCode`. */
export abstract class BoltzPayError extends Error {
  abstract readonly code: string;
  abstract readonly statusCode: number;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}
