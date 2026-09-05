import { useCallback, useEffect, useState } from 'react'
import { decodePortraitFile, renderPortraitCrop, saveCustomPortrait } from '../../lib/customPortraits.ts'
import { Button } from './Button.tsx'

export function CustomPortraitEditor({ character, instance, initialUrl, onSaved, onCancel }: {
  character: string
  instance: string
  initialUrl: string | null
  onSaved: (url: string) => void
  onCancel: () => void
}) {
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [zoom, setZoom] = useState(1)
  const [x, setX] = useState(0)
  const [y, setY] = useState(0)
  const [preview, setPreview] = useState(initialUrl)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!initialUrl) return
    const existing = new Image()
    existing.src = initialUrl
    void existing.decode().then(() => setImage(existing)).catch(() => setError('The saved portrait can no longer be decoded. Choose a replacement.'))
  }, [initialUrl])

  useEffect(() => {
    if (!image) return
    try { setPreview(renderPortraitCrop(image, zoom, x, y)); setError('') }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }, [image, zoom, x, y])

  const accept = useCallback(async (file?: File) => {
    if (!file) return
    try { setImage(await decodePortraitFile(file)); setZoom(1); setX(0); setY(0); setError('') }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }, [])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3" tabIndex={0} aria-label="Custom portrait editor; paste an image anywhere in this panel" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void accept(event.dataTransfer.files[0]) }} onPaste={(event) => void accept([...event.clipboardData.files].find((file) => file.type.startsWith('image/')))}>
      <div className="rounded-lg border border-dashed border-info/50 bg-surface-raised p-3 text-center">
        <label className="cursor-pointer text-sm text-info hover:underline">
          Choose your own image
          <input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void accept(event.target.files?.[0])} />
        </label>
        <p className="mt-1 text-xs text-ink-muted">Or drop or paste an image here. It stays on this machine unless you separately choose to publish it.</p>
      </div>
      {preview && (
        <div className="flex items-end justify-center gap-6">
          <figure className="text-center"><img src={preview} alt="Dashboard portrait preview" className="h-40 w-[120px] rounded border border-border object-cover" /><figcaption className="mt-1 text-xs text-ink-faint">Dashboard card</figcaption></figure>
          <figure className="text-center"><img src={preview} alt="Combat radar portrait preview" className="h-24 w-[72px] rounded-full border border-info/40 object-cover" /><figcaption className="mt-1 text-xs text-ink-faint">Combat radar</figcaption></figure>
        </div>
      )}
      {image && <div className="grid gap-2 text-xs text-ink-muted sm:grid-cols-3">
        <label>Zoom <input className="w-full accent-accent" type="range" min="1" max="3" step="0.05" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label>
        <label>Left / right <input className="w-full accent-accent" type="range" min="-100" max="100" value={x} onChange={(event) => setX(Number(event.target.value))} /></label>
        <label>Up / down <input className="w-full accent-accent" type="range" min="-100" max="100" value={y} onChange={(event) => setY(Number(event.target.value))} /></label>
      </div>}
      {error && <p role="alert" className="rounded border border-danger/40 bg-danger/10 px-2 py-1 text-xs text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>Back</Button>
        <Button size="sm" disabled={!preview || saving} onClick={() => void (async () => {
          if (!preview) return
          setSaving(true); setError('')
          try { onSaved(await saveCustomPortrait(character, instance, preview)) }
          catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
          finally { setSaving(false) }
        })()}>{saving ? 'Saving…' : initialUrl ? 'Save new crop' : 'Use this portrait'}</Button>
      </div>
    </div>
  )
}
