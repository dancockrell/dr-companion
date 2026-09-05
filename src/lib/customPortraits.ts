import { invokeTauri, isTauri } from './tauri.ts'

export const MAX_SOURCE_BYTES = 20_000_000
export const MAX_SOURCE_DIMENSION = 12_000
export const OUTPUT_SIZE = 1024

export async function readCustomPortrait(character: string, instance: string): Promise<string | null> {
  if (!isTauri()) return null
  return await invokeTauri('read_custom_portrait', { name: character, instance }) as string | null
}

export async function saveCustomPortrait(character: string, instance: string, dataUrl: string): Promise<string> {
  if (!isTauri()) throw new Error('Custom portraits are saved by the desktop app.')
  const marker = 'base64,'
  const at = dataUrl.indexOf(marker)
  if (!dataUrl.startsWith('data:image/webp;') || at < 0) throw new Error('The processed portrait is not WebP.')
  return await invokeTauri('save_custom_portrait', { name: character, instance, webpBase64: dataUrl.slice(at + marker.length) }) as string
}

export async function removeCustomPortrait(character: string, instance: string): Promise<void> {
  if (!isTauri()) return
  await invokeTauri('remove_custom_portrait', { name: character, instance })
}

export async function decodePortraitFile(file: File): Promise<HTMLImageElement> {
  if (!file.type.startsWith('image/')) throw new Error('Choose a PNG, JPEG, or WebP image.')
  if (file.size <= 0 || file.size > MAX_SOURCE_BYTES) throw new Error('Choose an image no larger than 20 MB.')
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth > MAX_SOURCE_DIMENSION || image.naturalHeight > MAX_SOURCE_DIMENSION) {
      throw new Error('Image dimensions must be between 1 and 12,000 pixels.')
    }
    URL.revokeObjectURL(url)
    return image
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error instanceof Error ? error : new Error('The selected image could not be decoded.')
  }
}

export function renderPortraitCrop(image: HTMLImageElement, zoom: number, x: number, y: number): string {
  const canvas = document.createElement('canvas')
  canvas.width = OUTPUT_SIZE
  canvas.height = OUTPUT_SIZE
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Image processing is unavailable.')
  const cover = Math.max(OUTPUT_SIZE / image.naturalWidth, OUTPUT_SIZE / image.naturalHeight)
  const scale = cover * Math.max(1, zoom)
  const width = image.naturalWidth * scale
  const height = image.naturalHeight * scale
  const overflowX = Math.max(0, width - OUTPUT_SIZE)
  const overflowY = Math.max(0, height - OUTPUT_SIZE)
  const left = -(overflowX * ((x + 100) / 200))
  const top = -(overflowY * ((y + 100) / 200))
  context.drawImage(image, left, top, width, height)
  const output = canvas.toDataURL('image/webp', 0.86)
  if (output.length > 1_340_000) throw new Error('The processed portrait exceeds the 1 MB storage limit. Choose a simpler crop.')
  return output
}
