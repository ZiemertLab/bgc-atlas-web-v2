// Its own module so the browser and server share it without pulling in next/server or crypto.
export const SERVER_ERROR_MESSAGE = 'Something went wrong on our side. Please try again in a few minutes.';

export const withReference = (reference: string | null | undefined): string =>
  reference ? `${SERVER_ERROR_MESSAGE} (ref ${reference})` : SERVER_ERROR_MESSAGE;

/** A reference as serverError mints it: six hex characters. Anything else is not shown. */
export const isErrorReference = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{6}$/.test(value);
