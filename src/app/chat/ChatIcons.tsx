type IconProps = { size?: number; title?: string };

export function PaperclipIcon({ size = 20, title }: IconProps) {
  return <svg aria-hidden={title ? undefined : true} role={title ? "img" : undefined} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{title && <title>{title}</title>}<path d="m20.5 11.5-8.9 8.9a6 6 0 0 1-8.5-8.5l9.6-9.6a4 4 0 1 1 5.7 5.7l-9.7 9.7a2 2 0 0 1-2.8-2.8l9-9"/></svg>;
}

export function SendIcon({ size = 20, title }: IconProps) {
  return <svg aria-hidden={title ? undefined : true} role={title ? "img" : undefined} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{title && <title>{title}</title>}<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>;
}

export function CloseIcon({ size = 18, title }: IconProps) {
  return <svg aria-hidden={title ? undefined : true} role={title ? "img" : undefined} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">{title && <title>{title}</title>}<path d="m6 6 12 12M18 6 6 18"/></svg>;
}

export function PhotoIcon({ size = 20, title }: IconProps) {
  return <svg aria-hidden={title ? undefined : true} role={title ? "img" : undefined} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{title && <title>{title}</title>}<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m21 15-5-5L5 20"/></svg>;
}

