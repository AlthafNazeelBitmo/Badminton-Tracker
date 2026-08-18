import { IDEMPOTENCY_KEY_HEADER as CONTRACT_IDEMPOTENCY_KEY_HEADER } from '@badminton/contracts';

/**
 * Header names the API defines.
 *
 * `IDEMPOTENCY_KEY_HEADER` is re-exported from the shared contracts package rather than
 * retyped, so the client and the server can never disagree about it. `CLIENT_KIND_HEADER`
 * is declared here because it is the client's own assertion about itself; the server
 * reads it but does not define the vocabulary.
 */

export const IDEMPOTENCY_KEY_HEADER = CONTRACT_IDEMPOTENCY_KEY_HEADER;

/**
 * Identifies this as a native client.
 *
 * The API returns session tokens in the response body only when it sees this. A browser
 * gets httpOnly cookies instead, which is the safer default and therefore what the server
 * assumes for anything that does not say otherwise.
 */
export const CLIENT_KIND_HEADER = 'X-Client-Kind';
