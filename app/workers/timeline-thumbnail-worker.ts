interface ThumbnailEncodeRequest {
  id: number
  bitmap: ImageBitmap
  width: number
  height: number
  quality: number
}

interface ThumbnailEncodeResponse {
  id: number
  src?: string
  error?: string
}

interface ThumbnailWorkerScope {
  onmessage: ((event: MessageEvent<ThumbnailEncodeRequest>) => void) | null
  postMessage: (message: ThumbnailEncodeResponse) => void
}

const blobToDataUrl = (blob: Blob) => {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('Failed to encode thumbnail'))
    reader.readAsDataURL(blob)
  })
}

const scope = self as unknown as ThumbnailWorkerScope

scope.onmessage = async (event) => {
  const { id, bitmap, width, height, quality } = event.data
  let bitmapClosed = false

  const closeBitmap = () => {
    if (bitmapClosed) return
    bitmapClosed = true
    bitmap.close()
  }

  try {
    if (typeof OffscreenCanvas === 'undefined') {
      throw new Error('OffscreenCanvas is unavailable')
    }

    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) {
      throw new Error('Failed to create thumbnail canvas')
    }

    context.drawImage(bitmap, 0, 0, width, height)
    closeBitmap()
    const blob = await canvas.convertToBlob({
      type: 'image/jpeg',
      quality
    })
    const src = await blobToDataUrl(blob)
    scope.postMessage({ id, src })
  } catch (error) {
    closeBitmap()
    scope.postMessage({
      id,
      error: error instanceof Error ? error.message : 'Thumbnail worker failed'
    })
  }
}

export {}
