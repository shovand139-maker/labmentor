import type { z } from "zod";

/** RFC 9457 problem details. `code` is stable and safe for clients to branch on; `detail` is for people. */
export type Problem = {
  type: "about:blank";
  title: string;
  status: number;
  code: string;
  detail: string;
  errors?: Record<string, string[]>;
};

const TITLES: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  409: "Conflict",
  413: "Content Too Large",
  415: "Unsupported Media Type",
  422: "Unprocessable Content",
  429: "Too Many Requests",
  500: "Internal Server Error",
  503: "Service Unavailable",
};

export function problem(
  status: number,
  code: string,
  detail: string,
  extra: {
    errors?: Record<string, string[]>;
    headers?: Record<string, string>;
  } = {},
): Response {
  const body: Problem = {
    type: "about:blank",
    title: TITLES[status] ?? "Error",
    status,
    code,
    detail,
  };
  if (extra.errors) body.errors = extra.errors;
  return Response.json(body, {
    status,
    headers: {
      "Content-Type": "application/problem+json",
      "Cache-Control": "no-store",
      ...extra.headers,
    },
  });
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  return Response.json(data, {
    ...init,
    headers: { "Cache-Control": "no-store", ...init.headers },
  });
}

export function validationProblem(error: z.ZodError): Response {
  const errors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const field = issue.path.join(".") || "body";
    (errors[field] ??= []).push(issue.message);
  }
  return problem(422, "validation_failed", "Some fields are not valid.", {
    errors,
  });
}

/** Parse a JSON body against a schema. Returns the data or a ready-to-send problem response. */
export async function readJson<T extends z.ZodType>(
  request: Request,
  schema: T,
  maxBytes = 16_384,
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; response: Response }> {
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  ) {
    return {
      ok: false,
      response: problem(
        415,
        "json_required",
        "Send the body as application/json.",
      ),
    };
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).length > maxBytes) {
    return {
      ok: false,
      response: problem(
        413,
        "body_too_large",
        `The body must be under ${maxBytes} bytes.`,
      ),
    };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return {
      ok: false,
      response: problem(400, "invalid_json", "The body is not valid JSON."),
    };
  }
  const parsed = schema.safeParse(value);
  return parsed.success
    ? { ok: true, data: parsed.data }
    : { ok: false, response: validationProblem(parsed.error) };
}
