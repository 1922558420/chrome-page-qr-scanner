import { prepareZXingModule, readBarcodes } from './vendor/reader/index.js';

prepareZXingModule({
  overrides: { locateFile: () => new URL('./vendor/zxing_reader.wasm', import.meta.url).href }
});

const readerOptions = { formats: ['QRCode'], tryHarder: true, textMode: 'Plain', maxNumberOfSymbols: 64 };

self.onmessage = async ({ data: sources }) => {
  const results = new Map();
  let scanned = 0;
  let failed = 0;

  for (const source of sources) {
    try {
      await scanImage(source, results);
      scanned += 1;
    } catch (error) {
      console.warn('QR image scan failed', error);
      failed += 1;
    }
  }

  self.postMessage({ results: [...results.values()], scanned, failed });
};

async function scanImage(source, results) {
  const blob = await (await fetch(source)).blob();
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, 3200 / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d', { alpha: false });
    context.drawImage(bitmap, 0, 0, width, height);
    const codes = await readBarcodes(context.getImageData(0, 0, width, height), readerOptions);

    for (const { text, position } of codes) {
      if (!text || results.has(text)) continue;
      results.set(text, { text, thumbnail: await makeThumbnail(canvas, position) });
    }
  } finally {
    bitmap.close();
  }
}

async function makeThumbnail(canvas, { topLeft, topRight, bottomLeft, bottomRight }) {
  const corners = [topLeft, topRight, bottomLeft, bottomRight];
  const minX = Math.min(...corners.map(({ x }) => x));
  const maxX = Math.max(...corners.map(({ x }) => x));
  const minY = Math.min(...corners.map(({ y }) => y));
  const maxY = Math.max(...corners.map(({ y }) => y));
  const side = Math.max(maxX - minX, maxY - minY) * 1.12;
  const size = 96;
  const thumbnail = new OffscreenCanvas(size, size);
  const context = thumbnail.getContext('2d', { alpha: false });
  context.fillStyle = '#fff';
  context.fillRect(0, 0, size, size);
  if (side > 0) {
    const x = (minX + maxX - side) / 2;
    const y = (minY + maxY - side) / 2;
    context.drawImage(canvas, x, y, side, side, 0, 0, size, size);
  }
  return thumbnail.convertToBlob();
}
