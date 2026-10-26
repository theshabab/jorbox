import { MAX_BODY_BYTES } from '../src/utils/cardFormats.js';

export const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
export const json = (data, status = 200) => Response.json(data, { status });
export const statement = (env, sql, ...values) =>
  env.DB.prepare(sql).bind(...values);

export function decodeSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    fail(400, 'Invalid address.');
  }
}

export async function readBody(request) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json'))
    fail(415, 'Send JSON data.');
  const reader = request.body?.getReader();
  if (!reader) fail(400, 'Missing request body.');
  let size = 0;
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      fail(413, `Request is too large (maximum ${MAX_BODY_BYTES / 1024} KB).`);
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(merged));
  } catch {
    fail(400, 'Invalid JSON.');
  }
}
