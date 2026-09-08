import { Alert } from 'react-native';
export function confirmAction(title: string, message: string, cancelLabel: string, actionLabel: string, onConfirm: () => void): void {
  Alert.alert(title, message, [{ text: cancelLabel, style: 'cancel' }, { text: actionLabel, onPress: onConfirm }]);
}
