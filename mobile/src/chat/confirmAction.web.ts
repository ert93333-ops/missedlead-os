/**
 * 웹 확인 다이얼로그(window.confirm) 래퍼.
 */
export function confirmAction(title: string, message: string, _cancelLabel: string, _actionLabel: string, onConfirm: () => void): void {
  if (window.confirm(title + '\n\n' + message)) onConfirm();
}
