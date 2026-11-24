// This function is serialized by chrome.scripting and runs in the tab's isolated world.
export function collectPageImages() {
  const maxImages = 120;
  const maxBytes = 8_000_000;
  const sources = [];
  const seenSources = new Set();
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { alpha: false });
  let bytes = 0;
  let limited = false;

  for (const element of document.querySelectorAll('img, canvas')) {
    const image = element instanceof HTMLImageElement;
    const width = image ? element.naturalWidth : element.width;
    const height = image ? element.naturalHeight : element.height;
    if (width < 21 || height < 21 || (image && !element.complete)) continue;
    if (element.checkVisibility?.({ visibilityProperty: true, opacityProperty: true }) === false) continue;

    const url = image ? element.currentSrc : '';
    if (url && seenSources.has(url)) continue;
    if (sources.length >= maxImages) {
      limited = true;
      break;
    }

    const scale = Math.min(1, 1500 / Math.max(width, height));
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    try {
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(element, 0, 0, canvas.width, canvas.height);
      const source = canvas.toDataURL('image/webp', 0.9);
      if (bytes + source.length > maxBytes) {
        limited = true;
        continue;
      }
      bytes += source.length;
      if (url) seenSources.add(url);
      sources.push(source);
    } catch (error) {
      // A cross-origin image may be readable through the viewport screenshot.
      if (error.name !== 'SecurityError' && error.name !== 'InvalidStateError') throw error;
    }
  }

  return { sources, limited };
}
