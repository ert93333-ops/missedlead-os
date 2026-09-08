export function confirmAction(title: string, message: string, _cancelLabel: string, _actionLabel: string, onConfirm: () => void): void {
  if (window.confirm(title + '\n\n' + message)) onConfirm();
}
