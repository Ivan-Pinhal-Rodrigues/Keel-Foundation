import type { ZodType } from "zod";

/**
 * The client-side typed `fetch` wrapper `plans/DESIGN.md` §8 promised — the
 * browser counterpart to the server's `mapError` (`errors.ts`). Client
 * components call this instead of hand-rolling `fetch()` with `as` casts.
 *
 * - Throws {@link ApiError} on any non-2xx response, with the JSON body attached
 *   when the response carried parseable JSON (a non-JSON error body → `null`).
 * - A `204`, or any other empty 2xx body, resolves to `undefined`.
 * - When `opts.schema` is given the 2xx body is `schema.parse`d — a wire shape
 *   that does not match throws that schema's `ZodError`, not an `ApiError`.
 * - A transport failure (offline, DNS, `AbortSignal`) rejects with whatever
 *   `fetch` threw, untouched — callers tell the two apart with
 *   `instanceof ApiError`.
 *
 * This file runs in the browser: never import `errors.ts`, `with-request.ts`,
 * Prisma, or anything else server-only here.
 */

/** The JSON error body every route produces via `mapError` (`errors.ts`). */
export type ApiErrorBody = {
  error?: string;
  overrideAction?: string;
  issues?: unknown;
};

/** A non-2xx HTTP response. `body` is the parsed JSON error body, or `null`. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public body: ApiErrorBody | null,
  ) {
    super(`api ${status}`);
  }
}

export type ApiFetchOptions<T> = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  /** Serialised as JSON; sets `content-type` when present. */
  body?: unknown;
  /** Parses (and types) the 2xx body. Omit for a `void` / 204 endpoint. */
  schema?: ZodType<T>;
  signal?: AbortSignal;
};

export async function apiFetch<T = unknown>(
  path: string,
  opts?: ApiFetchOptions<T>,
): Promise<T> {
  const body = opts?.body;
  const hasBody = body != null;

  const res = await fetch(path, {
    method: opts?.method,
    headers: hasBody ? { "content-type": "application/json" } : undefined,
    body: hasBody ? JSON.stringify(body) : undefined,
    signal: opts?.signal,
  });

  if (!res.ok) throw new ApiError(res.status, await parseErrorBody(res));

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (text === "") return undefined as T;

  const data = JSON.parse(text) as unknown;
  const schema = opts?.schema;
  return schema ? schema.parse(data) : (data as T);
}

/** The error body when the response carried parseable JSON, else `null`. */
async function parseErrorBody(res: Response): Promise<ApiErrorBody | null> {
  const text = await res.text().catch(() => "");
  if (text === "") return null;
  try {
    return JSON.parse(text) as ApiErrorBody;
  } catch {
    return null;
  }
}
