/** An error an API answered with, or a failure to reach it. */
export class ApiError extends Error {
  constructor(
    message: string,
    /** The real status: from the envelope's header, or the HTTP status (0: no answer at all). */
    readonly code: number,
    /** The response's `data`: for a refused form, `{ errors: { field: message } }`. */
    readonly data: unknown = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** The fields a refused request body names, with what is wrong with each. */
  get fieldErrors(): Record<string, string> {
    const errors = (this.data as { errors?: unknown } | null)?.errors;
    return typeof errors === 'object' && errors !== null ? (errors as Record<string, string>) : {};
  }

  get isUnauthorised(): boolean {
    return this.code === 401;
  }
}
