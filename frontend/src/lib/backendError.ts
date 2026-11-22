/**
 * The message and code out of a failed backend response.
 *
 * Every backend error comes wrapped: `{ success: false, error: { code, message } }`
 * (app/core/exceptions.py). The auth proxy routes read `detail` and a top-level
 * `message`, which never exist on it, so every failure became "Request failed".
 * The flat fields are still read for anything that answers before the handlers.
 */
export function backendError(data: unknown): { message?: string; code?: string } {
  const body = (data ?? {}) as {
    error?: { code?: string; message?: string };
    detail?: unknown;
    message?: string;
    code?: string;
  };
  return {
    message: body.error?.message ?? (typeof body.detail === 'string' ? body.detail : undefined) ?? body.message,
    code: body.error?.code ?? body.code,
  };
}
