import { useEffect, useRef, useState } from 'react'
import { X, Share2, Copy, Check } from 'lucide-react'
import { useStore } from '@/lib/store'
import { copyOrShareUrl, copyTextToClipboardSync } from '@/lib/listingShare'

/** Reliable share/copy UI — especially for iOS over HTTP where native share/clipboard often fail silently. */
export default function ShareSheet() {
  const shareSheet = useStore((s) => s.shareSheet)
  const closeShareSheet = useStore((s) => s.closeShareSheet)
  const inputRef = useRef<HTMLInputElement>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!shareSheet) return
    setCopied(false)
    const input = inputRef.current
    if (!input) return
    input.focus()
    input.select()
    input.setSelectionRange(0, shareSheet.url.length)
    if (!window.isSecureContext) {
      try {
        copyTextToClipboardSync(shareSheet.url)
      } catch {
        /* user can copy from the selected field */
      }
    }
  }, [shareSheet])

  if (!shareSheet) return null

  const { url, title } = shareSheet

  const handleNativeShare = async () => {
    try {
      await copyOrShareUrl(url, title)
      closeShareSheet()
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
    }
  }

  const handleCopy = () => {
    try {
      copyTextToClipboardSync(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-end justify-center p-4 bg-black/40"
      onClick={closeShareSheet}
      role="presentation"
    >
      <div
        className="w-full max-w-md bg-white rounded-2xl shadow-xl p-5 mb-2"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="share-sheet-title"
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <h2 id="share-sheet-title" className="text-lg font-semibold text-[var(--color-text)] leading-snug">
            Share link
          </h2>
          <button
            type="button"
            onClick={closeShareSheet}
            className="w-9 h-9 rounded-full hover:bg-gray-100 flex items-center justify-center cursor-pointer shrink-0 touch-manipulation"
            aria-label="Close"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <input
          ref={inputRef}
          readOnly
          value={url}
          className="w-full px-3 py-2.5 text-sm border border-[var(--color-border)] rounded-lg bg-gray-50 text-[var(--color-text)] mb-4 touch-manipulation"
          onFocus={(e) => e.currentTarget.select()}
        />

        <div className="flex gap-2">
          {window.isSecureContext && typeof navigator.share === 'function' && (
            <button
              type="button"
              onClick={() => void handleNativeShare()}
              className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-[var(--color-text)] text-white py-3 text-sm font-medium cursor-pointer touch-manipulation"
            >
              <Share2 className="w-4 h-4" />
              Share
            </button>
          )}
          <button
            type="button"
            onClick={handleCopy}
            className={`flex-1 flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-medium cursor-pointer touch-manipulation transition-colors ${
              copied
                ? 'border border-green-500 bg-green-50 text-green-700'
                : 'border border-[var(--color-border)] text-[var(--color-text)] hover:bg-gray-50'
            }`}
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copied ? 'Copied!' : 'Copy link'}
          </button>
        </div>
      </div>
    </div>
  )
}
