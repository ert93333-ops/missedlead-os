import type { ComponentType } from "react";

export type IconProps = { size?: number; title?: string; className?: string };
export type IconComponent = ComponentType<IconProps>;

function svg(props: IconProps, children: React.ReactNode) {
  const size = props.size ?? 20;
  return <svg className={props.className} aria-hidden={props.title ? undefined : true} role={props.title ? "img" : undefined} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{props.title && <title>{props.title}</title>}{children}</svg>;
}

export function WrenchIcon(props: IconProps) {
  return svg(props, <path d="M14.7 6.3a4.5 4.5 0 0 0-6 6L3 18l3 3 5.7-5.7a4.5 4.5 0 0 0 6-6L14 13l-3-3 3.7-3.7Z"/>);
}

export function DropletIcon(props: IconProps) {
  return svg(props, <><path d="M12 3s6.5 6.6 6.5 11a6.5 6.5 0 0 1-13 0C5.5 9.6 12 3 12 3Z"/><path d="M9.5 14a2.5 2.5 0 0 0 2.5 2.5"/></>);
}

export function ThermometerIcon(props: IconProps) {
  return svg(props, <><path d="M10 13.5V5a2 2 0 1 1 4 0v8.5a4.5 4.5 0 1 1-4 0Z"/><path d="M12 10v7"/><circle cx="12" cy="18" r="1.2" fill="currentColor" stroke="none"/></>);
}

export function BoltIcon(props: IconProps) {
  return svg(props, <path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H13L13 2Z"/>);
}

export function HouseIcon(props: IconProps) {
  return svg(props, <><path d="m3 11 9-8 9 8"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5h4v5"/></>);
}

export function ApplianceIcon(props: IconProps) {
  return svg(props, <><rect x="4" y="3" width="16" height="18" rx="2"/><circle cx="12" cy="13" r="4"/><path d="M4 7h16"/><circle cx="7.5" cy="5" r=".4" fill="currentColor"/></>);
}

export function WarningIcon(props: IconProps) {
  return svg(props, <><path d="M12 3.5 2.5 20h19L12 3.5Z"/><path d="M12 10v4.5"/><circle cx="12" cy="17.3" r=".4" fill="currentColor"/></>);
}

export function ShieldCheckIcon(props: IconProps) {
  return svg(props, <><path d="M12 3 5 5.8v5.4c0 4.4 2.9 7.4 7 9.3 4.1-1.9 7-4.9 7-9.3V5.8L12 3Z"/><path d="m9 11.5 2.2 2.2L15.4 9.5"/></>);
}

export function DocumentIcon(props: IconProps) {
  return svg(props, <><path d="M6 3h8l4 4v14H6V3Z"/><path d="M14 3v4h4"/><path d="M9 12h6M9 15.5h6"/></>);
}

export function CalendarIcon(props: IconProps) {
  return svg(props, <><rect x="3.5" y="5" width="17" height="16" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="M8 14.5h3"/></>);
}

export function ReceiptIcon(props: IconProps) {
  return svg(props, <><path d="M5 3h14v18l-2.3-1.5L14.4 21l-2.4-1.5L9.6 21l-2.3-1.5L5 21V3Z"/><path d="M8.5 8h7M8.5 12h7M8.5 16h4"/></>);
}

export function CameraIcon(props: IconProps) {
  return svg(props, <><path d="M4 8h3l2-2.5h6L17 8h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13.5" r="3.5"/></>);
}

export function StarIcon(props: IconProps) {
  return svg(props, <path d="m12 3.5 2.6 5.3 5.9.9-4.2 4.1 1 5.8L12 16.7l-5.3 2.9 1-5.8-4.2-4.1 5.9-.9L12 3.5Z"/>);
}

export function ClipboardIcon(props: IconProps) {
  return svg(props, <><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4a3 3 0 0 1 6 0"/><path d="M8.5 10.5h7M8.5 14h7M8.5 17.5h4"/></>);
}

export function MessageIcon(props: IconProps) {
  return svg(props, <><path d="M4 5h16v11H9l-5 4V5Z"/><path d="M8 9h8M8 12h5"/></>);
}

export function LockIcon(props: IconProps) {
  return svg(props, <><rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/><circle cx="12" cy="15.5" r="1.2" fill="currentColor" stroke="none"/></>);
}

export function CheckCircleIcon(props: IconProps) {
  return svg(props, <><circle cx="12" cy="12" r="9"/><path d="m8 12.3 2.6 2.6L16 9.5"/></>);
}

export function EmptyBoxIcon(props: IconProps) {
  return svg(props, <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/></>);
}

export function GaugeIcon(props: IconProps) {
  return svg(props, <><path d="M4 17a8.5 8.5 0 1 1 16 0"/><path d="M12 17l3.5-5.5"/><circle cx="12" cy="17" r="1.4"/></>);
}
