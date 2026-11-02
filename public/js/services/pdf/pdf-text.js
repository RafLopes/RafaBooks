// Leitura de PDFs no navegador com pdf.js (carregado sob demanda).

const PDFJS_BASE = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build';

let pdfjsPromise = null;

function loadPdfjs() {
  pdfjsPromise ??= import(`${PDFJS_BASE}/pdf.min.mjs`).then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}/pdf.worker.min.mjs`;
    return lib;
  });
  return pdfjsPromise;
}

/** @param {Blob} blob */
export async function openPdf(blob) {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(await blob.arrayBuffer());
  return pdfjs.getDocument({ data }).promise;
}

/**
 * Extrai o texto de cada página.
 * @returns {Promise<{ page: number, text: string }[]>}
 */
export async function extractPages(pdf, { onProgress, signal } = {}) {
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    if (signal?.aborted) throw new DOMException('Cancelado.', 'AbortError');
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    let text = '';
    for (const item of content.items) {
      text += item.str + (item.hasEOL ? '\n' : ' ');
    }
    pages.push({ page: n, text: text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim() });
    page.cleanup();
    onProgress?.(n / pdf.numPages);
  }
  return pages;
}

/** Gera uma miniatura JPEG da primeira página (data URL pequena, ~20-40 KB). */
export async function renderCover(pdf, width = 240) {
  const page = await pdf.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: width / base.width });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  page.cleanup();
  return canvas.toDataURL('image/jpeg', 0.7);
}
