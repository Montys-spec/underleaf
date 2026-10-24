import { getDocument } from 'pdfjs-dist'
import './PdfRenderer'

/** Renders the first page of a PDF (e.g. a figure exported from a plotting tool) to an image URL. */
export async function pdfToImageUrl(data: Uint8Array, targetWidth = 1400): Promise<string> {
  const task = getDocument({ data: data.slice() })
  try {
    const doc = await task.promise
    const page = await doc.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: Math.min(4, targetWidth / base.width) })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    await page.render({ canvas, viewport }).promise
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('Could not render the PDF figure')
    return URL.createObjectURL(blob)
  } finally {
    void task.destroy()
  }
}
