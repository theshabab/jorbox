const MAX_BODY = 512 * 1024;
export const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
export const json = (data, status = 200) => Response.json(data, { status });

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
    if (size > MAX_BODY) {
      await reader.cancel();
      fail(413, 'Request is too large (maximum 512 KB).');
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
