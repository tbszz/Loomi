
const PNG_HEADER = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// Original page images are visual evidence; text extraction and OCR cannot
// establish the visual reading order or placement of resume sections.
export async function renderPdfPages(buffer, {
  signal,
  maxPages = 8,
  desiredWidth = 1200,
  maxTotalBytes = 16 * 1024 * 1024,
} = {}) {
  signal?.throwIfAborted();
  if (!(buffer instanceof Uint8Array) || !Buffer.from(buffer.subarray(0, 5)).equals(Buffer.from('%PDF-'))) {
    throw new Error('这不是有效的 PDF 文件，无法查看页面布局。');
  }
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 8) {
    throw new Error('PDF 页面查看数量必须为 1 至 8 页。');
  }
  if (!Number.isInteger(desiredWidth) || desiredWidth < 200 || desiredWidth > 2000) {
    throw new Error('PDF 页面图片宽度必须为 200 至 2000 像素。');
  }
  if (!Number.isInteger(maxTotalBytes) || maxTotalBytes < 1 || maxTotalBytes > 16 * 1024 * 1024) {
    throw new Error('PDF 页面图片总大小限制无效。');
  }

  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: buffer });
  try {
    const info = await parser.getInfo();
    signal?.throwIfAborted();
    const totalPages = info.total;
    if (!Number.isInteger(totalPages) || totalPages < 1) throw new Error('PDF 没有可查看的页面。');
    const pages = [];
    let totalBytes = 0;
    for (let pageNumber = 1; pageNumber <= Math.min(totalPages, maxPages); pageNumber++) {
      signal?.throwIfAborted();
      const screenshot = await parser.getScreenshot({
        partial: [pageNumber], desiredWidth, imageBuffer: true, imageDataUrl: false,
      });
      signal?.throwIfAborted();
      const page = screenshot.pages?.find(value => value.pageNumber === pageNumber);
      const bytes = page?.data && Buffer.from(page.data);
      if (!bytes?.subarray(0, PNG_HEADER.length).equals(PNG_HEADER)) {
        throw new Error(`PDF 第 ${pageNumber} 页无法渲染为有效页面图片。`);
      }
      totalBytes += bytes.length;
      if (totalBytes > maxTotalBytes) throw new Error('PDF 页面图片超过大小限制，未完成布局查看。');
      pages.push({
        pageNumber,
        image: { type: 'image', source: { type: 'base64', media_type: 'image/png', data: bytes.toString('base64') } },
      });
    }
    return { pages, totalPages, complete: pages.length === totalPages, method: 'page-images' };
  } finally {
    await parser.destroy();
  }
}
