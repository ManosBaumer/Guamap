import { Share2 } from 'lucide-react'
import { useStore } from '@/lib/store'

type ShareLinkButtonProps = {
  url: string
  title: string
  disabled?: boolean
  className?: string
  iconClassName?: string
  'aria-label'?: string
}

/** Opens the share sheet — sync on tap so iOS registers the gesture reliably. */
export default function ShareLinkButton({
  url,
  title,
  disabled,
  className = 'w-9 h-9 rounded-full hover:bg-gray-100 flex items-center justify-center cursor-pointer transition-colors touch-manipulation',
  iconClassName = 'w-4 h-4 text-gray-400 pointer-events-none',
  'aria-label': ariaLabel = 'Share link',
}: ShareLinkButtonProps) {
  const openShareSheet = useStore((s) => s.openShareSheet)

  return (
    <button
      type="button"
      disabled={disabled || !url}
      aria-label={ariaLabel}
      className={className}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (!url) return
        openShareSheet({ url, title })
      }}
    >
      <Share2 className={iconClassName} />
    </button>
  )
}
