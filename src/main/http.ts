import { z } from "zod";
export function localOrigin(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  )
    throw new Error("Use the local T3 HTTP address, without a path or token.");
  return url.origin;
}
export async function request(
  origin: string,
  path: string,
  token: string | null,
  signal: AbortSignal,
  body?: unknown,
): Promise<unknown> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let encoded: string | undefined;
  if (body instanceof URLSearchParams) {
    encoded = body.toString();
    headers["Content-Type"] = "application/x-www-form-urlencoded";
  } else if (body !== undefined) {
    encoded = JSON.stringify(body);
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch(new URL(path, origin), {
    method: encoded === undefined ? "GET" : "POST",
    headers,
    ...(encoded === undefined ? {} : { body: encoded }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    redirect: "error",
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(
      response.status === 401 || response.status === 403
        ? "T3 refused access. Connect again."
        : `T3 request failed (${response.status}).`,
    );
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("T3 returned no response.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 8 * 1024 * 1024) throw new Error("T3 response exceeds 8 MiB.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export const environmentSchema = z.object({
  environmentId: z.string().min(1).max(256),
  serverVersion: z.string(),
});
export const authSchema = z.object({
  authenticated: z.boolean(),
  scopes: z.array(z.string()),
});
export const tokenSchema = z.object({
  access_token: z.string().min(1).max(8192),
  token_type: z.literal("Bearer"),
  scope: z.string(),
});
