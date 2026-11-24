import { collectPageImages } from './page-images.js';

const ui = Object.fromEntries(
  ['rescan', 'first-scan', 'start-scan', 'status', 'status-title', 'status-detail', 'results', 'choices', 'destination',
    'destination-title', 'destination-value', 'feedback', 'actions', 'copy', 'open']
    .map(id => [id, document.getElementById(id)])
);

let tab;
let selected;
let previewUrls = [];

function setStatus(title, detail = '') {
  ui['status-title'].textContent = title;
  ui['status-detail'].textContent = detail;
}

function showFeedback(message = '') {
  ui.feedback.textContent = message;
  ui.feedback.hidden = !message;
}

function parseWebUrl(text) {
  const value = text.trim();
  if (!/^https?:\/\//i.test(value) || /[\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function select(result) {
  selected = result;
  ui.destination.hidden = !result;
  ui['destination-title'].textContent = result?.url ? '目标网址' : '二维码内容';
  ui['destination-value'].textContent = result?.url?.href ?? result?.text ?? '';
  ui.open.disabled = !result?.url;
  ui.copy.disabled = !result;
  showFeedback();
}

function showResults(results, limited) {
  if (results.length === 0) {
    setStatus('未找到二维码', '将二维码完整滚动到可见范围，再点击重新扫描。');
    return;
  }

  const hint = results.length === 1 ? '查看内容后可选择是否打开。' : '请选择一个二维码。';
  setStatus(`找到 ${results.length} 个二维码`, limited ? `${hint} 可滚动网页后继续扫描。` : hint);
  ui.results.hidden = false;
  ui.actions.hidden = false;

  for (const result of results) {
    result.url = parseWebUrl(result.text);
    const card = document.createElement('label');
    card.className = 'choice';

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'qr-choice';
    radio.addEventListener('change', () => select(result));

    const thumbnail = document.createElement('img');
    thumbnail.alt = '';
    thumbnail.src = URL.createObjectURL(result.thumbnail);
    previewUrls.push(thumbnail.src);

    const description = document.createElement('span');
    const title = document.createElement('strong');
    const details = document.createElement('small');
    title.dir = 'auto';
    title.textContent = result.url?.host ?? '文本或其他类型';
    details.dir = 'auto';
    details.textContent = result.url?.href ?? result.text;
    description.append(title, details);
    card.append(radio, thumbnail, description);
    ui.choices.append(card);

    if (results.length === 1) {
      radio.checked = true;
      select(result);
    }
  }
}

async function captureViewport(target) {
  const [before] = await chrome.tabs.query({ active: true, windowId: target.windowId });
  if (before?.id !== target.id) throw new Error('Active tab changed');
  const screenshot = await chrome.tabs.captureVisibleTab(target.windowId, { format: 'png' });
  const [after] = await chrome.tabs.query({ active: true, windowId: target.windowId });
  if (after?.id !== target.id || (target.url && after.url !== target.url)) {
    throw new Error('Active page changed');
  }
  return screenshot;
}

function decode(sources) {
  const worker = new Worker('scan-worker.js', { type: 'module' });
  return new Promise((resolve, reject) => {
    worker.onmessage = ({ data }) => resolve(data);
    worker.onerror = reject;
    worker.onmessageerror = reject;
    worker.postMessage(sources);
  }).finally(() => worker.terminate());
}

async function scan() {
  ui.rescan.disabled = true;
  ui.results.hidden = true;
  ui.actions.hidden = true;
  ui.choices.replaceChildren();
  previewUrls.forEach(url => URL.revokeObjectURL(url));
  previewUrls = [];
  select(null);
  setStatus('正在扫描当前网页…', '正在查找二维码');

  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id == null) throw new Error('No active tab');

    const [viewport, page] = await Promise.allSettled([
      captureViewport(tab),
      chrome.scripting.executeScript({ target: { tabId: tab.id }, func: collectPageImages })
    ]);

    if (viewport.status === 'rejected' && page.status === 'rejected') {
      setStatus('无法读取当前网页', '请切换到普通网页，或重新打开扩展后再试。');
      return;
    }

    const pageImages = page.value?.[0]?.result;
    const sources = viewport.value ? [viewport.value] : [];
    sources.push(...(pageImages?.sources ?? []));
    if (sources.length === 0) {
      setStatus('未读取到可扫描的图像', '请将二维码完整滚动到可见范围后重试。');
      return;
    }
    const { results, scanned, failed } = await decode(sources);
    if (scanned === 0) throw new Error('No image decoded');
    showResults(results, failed > 0 || !pageImages || pageImages.limited || !viewport.value);
  } catch (error) {
    console.warn('Page QR scan failed', error);
    setStatus('扫描失败', '请点击重新扫描重试。');
  } finally {
    ui.rescan.disabled = false;
  }
}

ui.rescan.addEventListener('click', scan);

ui.copy.addEventListener('click', async () => {
  const result = selected;
  if (!result) return;
  try {
    await navigator.clipboard.writeText(result.url?.href ?? result.text);
    if (selected === result) showFeedback('已复制');
  } catch {
    if (selected === result) showFeedback('复制失败，可以手动选中文本复制。');
  }
});

ui.open.addEventListener('click', async () => {
  const result = selected;
  if (!result?.url) return;
  ui.open.disabled = true;
  try {
    await chrome.tabs.create({ windowId: tab.windowId, url: result.url.href });
    window.close();
  } catch {
    if (selected === result) {
      ui.open.disabled = false;
      showFeedback('打开失败，可以复制链接。');
    }
  }
});

function startScanning() {
  ui['first-scan'].hidden = true;
  ui.status.hidden = false;
  scan();
}

if (localStorage.getItem('page-qr-scan-consent') === 'accepted') {
  startScanning();
} else {
  ui['first-scan'].hidden = false;
  ui['start-scan'].addEventListener('click', () => {
    localStorage.setItem('page-qr-scan-consent', 'accepted');
    startScanning();
  });
}
