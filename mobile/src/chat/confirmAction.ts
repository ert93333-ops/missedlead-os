/**
 * 네이티브 확인 다이얼로그(Alert.alert) 래퍼.
 */
import { Alert } from 'react-native';
export function confirmAction(title: string, message: string, cancelLabel: string, actionLabel: string, onConfirm: () => void): void {
  Alert.alert(title, message, [{ text: cancelLabel, style: 'cancel' }, { text: actionLabel, onPress: onConfirm }]);
}
