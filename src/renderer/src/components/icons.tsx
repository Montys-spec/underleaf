import type { ReactElement, SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function icon(paths: ReactElement) {
  return function Icon({ size = 16, ...rest }: IconProps) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...rest}>
        {paths}
      </svg>
    )
  }
}

export const FileIcon = icon(<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></>)
export const TexIcon = icon(<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M9 13h6M12 13v5" /></>)
export const ImageIcon = icon(<><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.8" /><path d="m21 16-5-5-9 9" /></>)
export const BibIcon = icon(<><path d="M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" /><path d="M5 17a3 3 0 0 1 3-3h10" /></>)
export const FolderIcon = icon(<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />)
export const FolderOpenIcon = icon(<><path d="M3 7a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v1" /><path d="M3 19 5.5 11h16L19 19z" /></>)
export const ChevronIcon = icon(<path d="m9 6 6 6-6 6" />)
export const ChevronDownIcon = icon(<path d="m6 9 6 6 6-6" />)
export const NewFileIcon = icon(<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M12 11v6M9 14h6" /></>)
export const NewFolderIcon = icon(<><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M12 10v6M9 13h6" /></>)
export const UploadIcon = icon(<><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></>)
export const RecompileIcon = icon(<><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 5v6h-6" /></>)
export const StopIcon = icon(<rect x="6" y="6" width="12" height="12" rx="2" />)
export const LogIcon = icon(<><path d="M8 6h12M8 12h12M8 18h12" /><circle cx="4" cy="6" r="0.6" /><circle cx="4" cy="12" r="0.6" /><circle cx="4" cy="18" r="0.6" /></>)
export const ZoomInIcon = icon(<><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4M8 11h6M11 8v6" /></>)
export const ZoomOutIcon = icon(<><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4M8 11h6" /></>)
export const FitIcon = icon(<><path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4" /></>)
export const ExternalIcon = icon(<><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></>)
export const SettingsIcon = icon(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>)
export const CloseIcon = icon(<path d="M6 6l12 12M18 6 6 18" />)
export const HomeIcon = icon(<><path d="m3 11 9-7 9 7" /><path d="M5 10v10h14V10" /></>)
export const ErrorIcon = icon(<><circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 16.5v.5" /></>)
export const WarningIcon = icon(<><path d="M12 3 2 20h20z" /><path d="M12 10v4M12 17v.5" /></>)
export const InfoIcon = icon(<><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.5" /></>)
export const StarIcon = icon(<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />)
export const LeafIcon = icon(<><path d="M5 19c0-8 5-14 15-15-1 10-7 15-15 15z" /><path d="M5 19 13 11" /></>)

export function fileIconFor(name: string): (p: IconProps) => ReactElement {
  if (/\.(tex|sty|cls|ltx)$/i.test(name)) return TexIcon
  if (/\.(png|jpe?g|gif|svg|pdf|eps|webp|bmp|tiff?)$/i.test(name)) return ImageIcon
  if (/\.bib$/i.test(name)) return BibIcon
  return FileIcon
}
