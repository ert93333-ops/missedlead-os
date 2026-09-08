import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Workspace } from './src/Workspace';
import { Payments } from './src/Payments';
import { useAuth } from './src/auth';
import { configured } from './src/config';


export default function App() {
  const auth = useAuth();
  const [es, setEs] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [signup, setSignup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  async function submit() {
    setBusy(true); setNotice('');
    try {
      if (!await auth.submit(email.trim(), password, signup)) setNotice(es ? 'Revise su correo para confirmar su cuenta.' : 'Check your email to confirm your account.');
    } catch (caught) { setNotice(caught instanceof Error ? caught.message : es ? 'No se pudo iniciar sesión.' : 'Could not sign in.'); }
    finally { setBusy(false); }
  }
  return <SafeAreaProvider><StatusBar style="dark"/><SafeAreaView style={styles.screen}>
    {auth.loading ? <ActivityIndicator accessibilityLabel="Loading"/> : auth.session ? <Payments><Workspace key={auth.session.user.id} accessToken={auth.session.access_token} onSignOut={() => void auth.signOut()}/></Payments> :
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <View style={styles.row}><Text style={styles.brand}>WeCover</Text><Pressable accessibilityRole="button" onPress={() => setEs(!es)} style={styles.secondary}><Text>{es ? 'English' : 'Español'}</Text></Pressable></View>
        <Text style={styles.title}>{es ? 'Ayuda para su hogar, en una conversación.' : 'Home repair help, one conversation away.'}</Text>
        <Text style={styles.body}>{es ? 'Comparta fotos o un video. Le ayudaremos a preparar su solicitud y encontrar técnicos.' : 'Share photos or a video. We’ll help prepare your request and find technicians.'}</Text>
        {!configured ? <Text accessibilityRole="alert" style={styles.notice}>{es ? 'El servicio no está disponible. Inténtelo más tarde.' : 'The service is unavailable. Please try again later.'}</Text> : <>
          <Text style={styles.label}>{es ? 'Correo electrónico o usuario' : 'Email or username'}</Text><TextInput accessibilityLabel="Email or username" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" style={styles.input}/>
          <Text style={styles.label}>{es ? 'Contraseña' : 'Password'}</Text><TextInput accessibilityLabel="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete={signup ? 'new-password' : 'current-password'} style={styles.input}/>
          <Pressable accessibilityRole="button" disabled={busy || !email.trim() || !password} onPress={() => void submit()} style={[styles.primary, (busy || !email.trim() || !password) && styles.disabled]}><Text style={styles.primaryText}>{busy ? (es ? 'Conectando…' : 'Connecting…') : signup ? (es ? 'Crear cuenta' : 'Create account') : (es ? 'Iniciar sesión' : 'Sign in')}</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={() => setSignup(!signup)} style={styles.secondary}><Text>{signup ? (es ? 'Ya tengo una cuenta' : 'I already have an account') : (es ? 'Crear una cuenta' : 'Create an account')}</Text></Pressable>
        </>}
        {(notice || auth.error) && <Text accessibilityRole="alert" style={styles.notice}>{notice || auth.error}</Text>}
        <Text style={styles.body}>{es ? 'No se cobra durante la consulta.' : 'No payment is collected during consultation.'}</Text>
      </ScrollView></KeyboardAvoidingView>}
  </SafeAreaView></SafeAreaProvider>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fffdf8' }, flex: { flex: 1 }, content: { padding: 24, gap: 18, flexGrow: 1, justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, brand: { fontSize: 25, fontWeight: '700', color: '#17463a' },
  title: { fontSize: 32, fontWeight: '700', color: '#17463a' }, body: { fontSize: 16, lineHeight: 24, color: '#52685f' }, label: { fontSize: 16, color: '#17463a' },
  input: { borderWidth: 1, borderColor: '#a6bcb2', borderRadius: 12, minHeight: 50, padding: 12, fontSize: 17 },
  primary: { minHeight: 50, borderRadius: 12, backgroundColor: '#17463a', alignItems: 'center', justifyContent: 'center', padding: 12 }, primaryText: { color: '#fff', fontSize: 17, fontWeight: '600' },
  secondary: { minHeight: 48, padding: 12, alignItems: 'center', justifyContent: 'center' }, disabled: { opacity: 0.45 }, notice: { padding: 14, backgroundColor: '#fff0d8', color: '#754a13', fontSize: 16 },
});
