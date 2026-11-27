import type { SVGProps } from 'react'

export type IconName =
  | 'home'
  | 'mic'
  | 'mic-off'
  | 'box'
  | 'receipt'
  | 'settings'
  | 'plus'
  | 'minus'
  | 'trash'
  | 'check'
  | 'check-circle'
  | 'chevron-right'
  | 'chevron-left'
  | 'search'
  | 'close'
  | 'alert'
  | 'sparkle'
  | 'printer'
  | 'edit'
  | 'download'
  | 'upload'
  | 'shield'
  | 'info'
  | 'volume'
  | 'wand'
  | 'arrow-right'
  | 'tag'
  | 'clock'
  | 'shop'
  | 'swap'

const PATHS: Record<IconName, string> = {
  home: '<path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1Z"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M9 21h6"/>',
  'mic-off': '<path d="M9 6a3 3 0 0 1 6 0v5M9 9v2a3 3 0 0 0 4.6 2.5M5.5 11.5a6.5 6.5 0 0 0 9.9 5.6M18.5 11.5a6.5 6.5 0 0 1-.6 2.7M12 18v3M9 21h6M3 3l18 18"/>',
  box: '<path d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5Z"/><path d="M4 8.5 12 13l8-4.5M12 13v7"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2Z"/><path d="M9 8h6M9 12h6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 8.9 19a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 4.5 15a1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.5 9a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 8.9 4.5H9A1.7 1.7 0 0 0 10 3V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  'check-circle': '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  'chevron-right': '<path d="m9 5 7 7-7 7"/>',
  'chevron-left': '<path d="m15 5-7 7 7 7"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m16 16 4 4"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  alert: '<path d="M12 3 2 20h20Z"/><path d="M12 9v5M12 17h.01"/>',
  sparkle: '<path d="M12 3l1.8 4.8L18.6 9.6l-4.8 1.8L12 16.2l-1.8-4.8L5.4 9.6l4.8-1.8Z"/><path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8Z"/>',
  printer: '<path d="M7 8V3h10v5"/><rect x="4" y="8" width="16" height="8" rx="2"/><path d="M7 14h10v7H7z"/>',
  edit: '<path d="M4 20h4L20 8l-4-4L4 16Z"/><path d="m14 6 4 4"/>',
  download: '<path d="M12 3v12m0 0 4-4m-4 4-4-4M4 19h16"/>',
  upload: '<path d="M12 16V4m0 0 4 4m-4-4L8 8M4 19h16"/>',
  shield: '<path d="M12 3 4.5 6v6c0 4.4 3.1 7.8 7.5 9 4.4-1.2 7.5-4.6 7.5-9V6Z"/><path d="m8.5 12 2.5 2.5L16 9.5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  volume: '<path d="M4 9v6h4l5 4V5L8 9Z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
  wand: '<path d="M4 20 15 9M14 4l1 2 2 1-2 1-1 2-1-2-2-1 2-1ZM19 11l.7 1.4 1.4.6-1.4.6-.7 1.4-.7-1.4-1.4-.6 1.4-.6Z"/>',
  'arrow-right': '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  tag: '<path d="M4 12V5a1 1 0 0 1 1-1h7l8 8-8 8Z"/><circle cx="8.5" cy="8.5" r="1.4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  shop: '<path d="M4 9h16v11H4Z"/><path d="M3 9l2-5h14l2 5M9 20v-6h6v6"/>',
  swap: '<path d="M4 8h13l-3-3M20 16H7l3 3"/>',
}

export interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName
  size?: number
}

/** Inline SVG icons — no icon font, no CDN, crisp at any size. */
export function Icon({ name, size = 20, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
      dangerouslySetInnerHTML={{ __html: PATHS[name] }}
    />
  )
}
