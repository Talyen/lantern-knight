export async function sha256(bytes: BufferSource) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

// All runtime PNGs preserve authored orientation, straight alpha and color data.
export async function verifiedBitmap(
  url: string,
  expected: { hash: string; width: number; height: number },
  request: typeof fetch = fetch,
) {
  const response = await request(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  if ((await sha256(bytes)) !== expected.hash) throw new Error(`${url}: hash mismatch`);
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), {
    imageOrientation: 'flipY',
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  });
  if (bitmap.width !== expected.width || bitmap.height !== expected.height) {
    bitmap.close();
    throw new Error(`${url}: image dimensions differ`);
  }
  return bitmap;
}
