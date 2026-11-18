// Response helpers. Errors shown to users are generic; details go to the function log with a
// reference id so they can still be traced. (#14)
const BASE_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "cache-control": "no-store",
};

export function json(data: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", ...BASE_HEADERS, ...extra } });
}

export function fail(status: number, message: string, extra: Record<string, string> = {}) {
  return json({ error: message }, status, extra);
}

export function serverError(err: unknown, ref: string) {
  console.error(`[${ref}]`, err);
  return fail(500, `Something went wrong on our side. Reference: ${ref}`);
}

export const refId = () => Math.random().toString(36).slice(2, 10);
