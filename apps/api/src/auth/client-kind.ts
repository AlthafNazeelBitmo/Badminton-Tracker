import type { Request } from 'express';

/**
 * Whether a request comes from a browser or a native app.
 *
 * The two need different token delivery, and the difference matters for security:
 *
 * - **Browsers** get httpOnly cookies. The token is unreachable from JavaScript, so an
 *   XSS bug cannot exfiltrate a session. Returning tokens in a JSON body to a browser
 *   would throw that away — the body is readable by any script on the page and is
 *   exactly the kind of thing that ends up in a logging or analytics tool.
 *
 * - **Native apps** cannot use httpOnly cookies meaningfully and have somewhere better
 *   to put a token: the iOS Keychain and the Android Keystore, both hardware-backed and
 *   outside the JavaScript sandbox. So they receive tokens in the response body and
 *   store them there.
 *
 * The client states which it is with an explicit header. Sniffing the user agent would
 * be guesswork, and guessing wrong in the browser direction is a security regression, so
 * anything that does not positively identify itself is treated as a browser.
 */
export const CLIENT_KIND_HEADER = 'x-client-kind';

export type ClientKind = 'web' | 'native';

export function clientKindOf(request: Request): ClientKind {
  return request.header(CLIENT_KIND_HEADER)?.toLowerCase() === 'native' ? 'native' : 'web';
}

export function isNativeClient(request: Request): boolean {
  return clientKindOf(request) === 'native';
}
