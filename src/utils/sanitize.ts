// Allowed characters: horizontal tabs, spaces or visible ascii characters: https://www.rfc-editor.org/rfc/rfc7230#section-3.1.2
// eslint-disable-next-line no-control-regex
const DISALLOWED_STATUS_CHARS = /[^\u0009\u0020-\u007E]/g;

/**
 * Make sure the status message is safe to use in a response.
 *
 * Allowed characters: horizontal tabs, spaces or visible ascii characters: https://www.rfc-editor.org/rfc/rfc7230#section-3.1.2
 */
export function sanitizeStatusMessage(statusMessage = ""): string {
  return statusMessage.replace(DISALLOWED_STATUS_CHARS, "");
}

/**
 * Make sure the status code is a valid HTTP status code.
 */
export function sanitizeStatusCode(
  statusCode?: string | number,
  defaultStatusCode = 200,
): number {
  if (!statusCode) {
    return defaultStatusCode;
  }
  if (typeof statusCode === "string") {
    statusCode = +statusCode;
  }
  if (statusCode < 100 || statusCode > 599) {
    return defaultStatusCode;
  }
  return statusCode;
}
