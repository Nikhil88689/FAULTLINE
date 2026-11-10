export type BoundedJsonResult =
  { ok: true; value: unknown } | { ok: false; reason: "too-large" | "invalid-json" };

/** Reads JSON with a strict byte ceiling, including requests without Content-Length. */
export async function readBoundedJson(
  request: Request,
  maximumBytes: number,
): Promise<BoundedJsonResult> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (Number.isFinite(length) && length > maximumBytes) {
      return { ok: false, reason: "too-large" };
    }
  }

  const reader = request.body?.getReader();
  if (!reader) return parseJson("");

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel();
        return { ok: false, reason: "too-large" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, reason: "invalid-json" };
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return parseJson(new TextDecoder().decode(body));
}

function parseJson(text: string): BoundedJsonResult {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, reason: "invalid-json" };
  }
}
