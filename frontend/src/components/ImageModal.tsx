import { X, ChevronLeft, ChevronRight } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '@/lib/store'
import { useEffect } from 'react'

export default function ImageModal() {
  const { modalImages, modalIndex, closeModal, modalNext, modalPrev } = useStore(
    useShallow((s) => ({
      modalImages: s.modalImages,
      modalIndex: s.modalIndex,
      closeModal: s.closeModal,
      modalNext: s.modalNext,
      modalPrev: s.modalPrev,
    })),
  )

  /** Warm the browser cache for every gallery image so prev/next reuse cached bytes. */
  useEffect(() => {
    if (!modalImages.length) return
    for (let i = 0; i < modalImages.length; i++) {
      const img = new Image()
      img.src = modalImages[i]
    }
  }, [modalImages])

  useEffect(() => {
    if (!modalImages.length) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') closeModal()
      if (e.key === 'ArrowRight') modalNext()
      if (e.key === 'ArrowLeft') modalPrev()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [modalImages, closeModal, modalNext, modalPrev])

  if (!modalImages.length) return null

  return (
    <div
      className="fixed inset-0 z-[10000] bg-black/90 flex items-center justify-center"
      onClick={closeModal}
    >
      <button
        onClick={closeModal}
        className="absolute top-5 right-5 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors cursor-pointer"
      >
        <X className="w-6 h-6 text-white" />
      </button>

      {modalImages.length > 1 && (
        <>
          <button
            onClick={(e) => { e.stopPropagation(); modalPrev() }}
            className="absolute left-5 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors cursor-pointer disabled:opacity-30"
            disabled={modalIndex <= 0}
          >
            <ChevronLeft className="w-6 h-6 text-white" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); modalNext() }}
            className="absolute right-5 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors cursor-pointer disabled:opacity-30"
            disabled={modalIndex >= modalImages.length - 1}
          >
            <ChevronRight className="w-6 h-6 text-white" />
          </button>
        </>
      )}

      <img
        src={modalImages[modalIndex]}
        alt=""
        decoding="async"
        fetchPriority="high"
        className="max-w-[90vw] max-h-[85vh] object-contain rounded-lg"
        onClick={(e) => e.stopPropagation()}
      />

      {modalImages.length > 1 && (
        <div className="absolute bottom-5 text-white/60 text-sm">
          {modalIndex + 1} / {modalImages.length}
        </div>
      )}
    </div>
  )
}
