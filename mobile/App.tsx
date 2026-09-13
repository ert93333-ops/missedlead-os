import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { BarlowCondensed_600SemiBold, BarlowCondensed_700Bold } from '@expo-google-fonts/barlow-condensed';
import { IBMPlexSans_400Regular, IBMPlexSans_600SemiBold, IBMPlexSans_700Bold } from '@expo-google-fonts/ibm-plex-sans';
import { IBMPlexMono_400Regular, IBMPlexMono_500Medium } from '@expo-google-fonts/ibm-plex-mono';
import Svg, { Line } from 'react-native-svg';
import { Workspace } from './src/Workspace';
import { Payments } from './src/Payments';
import { useAuth } from './src/auth';
import { configured } from './src/config';
import { font, skin } from './src/theme';

const paper = skin.customer;

function BlueprintGrid() {
  const { width, height } = useWindowDimensions();
  const step = 30;
  const lines = [];
  for (let x = 0; x <= width; x += step) lines.push(<Line key={`v${x}`} x1={x} y1={0} x2={x} y2={height} stroke={paper.gridLine} strokeWidth={1} />);
  for (let y = 0; y <= height; y += step) lines.push(<Line key={`h${y}`} x1={0} y1={y} x2={width} y2={y} stroke={paper.gridLine} strokeWidth={1} />);
  return <Svg style={StyleSheet.absoluteFill} pointerEvents="none">{lines}</Svg>;
}

export default function App() {
  const auth = useAuth();
  const [fontsReady, fontError] = useFonts({
    BarlowCondensed_600SemiBold, BarlowCondensed_700Bold,
    IBMPlexSans_400Regular, IBMPlexSans_600SemiBold, IBMPlexSans_700Bold,
    IBMPlexMono_400Regular, IBMPlexMono_500Medium,
  });
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
    {auth.loading || (!fontsReady && !fontError) ? <ActivityIndicator accessibilityLabel="Loading"/> : auth.session ? <Payments><Workspace key={auth.session.user.id} accessToken={auth.session.access_token} onSignOut={() => void auth.signOut()}/></Payments> :
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}><BlueprintGrid/><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <View style={styles.row}><Text style={styles.brand}>WeCover</Text><Pressable accessibilityRole="button" onPress={() => setEs(!es)} style={styles.secondary}><Text style={styles.secondaryText}>{es ? 'English' : 'Español'}</Text></Pressable></View>
        <Text style={styles.specLine}>Charlotte pilot · Home services</Text>
        <Text style={styles.title}>{es ? 'Ayuda para su hogar, en una conversación.' : 'Home repair help, one conversation away.'}</Text>
        <Text style={styles.body}>{es ? 'Comparta fotos o un video. Le ayudaremos a preparar su solicitud y encontrar técnicos.' : 'Share photos or a video. We’ll help prepare your request and find technicians.'}</Text>
        {!configured ? <Text accessibilityRole="alert" style={styles.notice}>{es ? 'El servicio no está disponible. Inténtelo más tarde.' : 'The service is unavailable. Please try again later.'}</Text> : <>
          <Text style={styles.label}>{es ? 'Correo electrónico o usuario' : 'Email or username'}</Text><TextInput accessibilityLabel="Email or username" placeholderTextColor={paper.muted} value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" style={styles.input}/>
          <Text style={styles.label}>{es ? 'Contraseña' : 'Password'}</Text><TextInput accessibilityLabel="Password" placeholderTextColor={paper.muted} value={password} onChangeText={setPassword} secureTextEntry autoComplete={signup ? 'new-password' : 'current-password'} style={styles.input}/>
          <Pressable accessibilityRole="button" disabled={busy || !email.trim() || !password} onPress={() => void submit()} style={[styles.primary, (busy || !email.trim() || !password) && styles.disabled]}><Text style={styles.primaryText}>{busy ? (es ? 'Conectando…' : 'Connecting…') : signup ? (es ? 'Crear cuenta' : 'Create account') : (es ? 'Iniciar sesión' : 'Sign in')}</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={() => setSignup(!signup)} style={styles.secondary}><Text style={styles.secondaryText}>{signup ? (es ? 'Ya tengo una cuenta' : 'I already have an account') : (es ? 'Crear una cuenta' : 'Create an account')}</Text></Pressable>
        </>}
        {(notice || auth.error) && <Text accessibilityRole="alert" style={styles.notice}>{notice || auth.error}</Text>}
        <Text style={styles.body}>{es ? 'No se cobra durante la consulta.' : 'No payment is collected during consultation.'}</Text>
      </ScrollView></KeyboardAvoidingView>}
  </SafeAreaView></SafeAreaProvider>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: paper.background }, flex: { flex: 1 }, content: { padding: 24, gap: 18, flexGrow: 1, justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, brand: { fontSize: 30, color: paper.text, fontFamily: font.display, letterSpacing: 1.2, textTransform: 'uppercase' },
  specLine: { fontSize: 11, color: paper.accent, fontFamily: font.monoMed, letterSpacing: 1.4, textTransform: 'uppercase', marginTop: -10 },
  title: { fontSize: 40, lineHeight: 40, color: paper.text, fontFamily: font.display, letterSpacing: 0.3 },
  body: { fontSize: 16, lineHeight: 24, color: paper.muted, fontFamily: font.body }, label: { fontSize: 15, color: paper.text, fontFamily: font.bodySemi },
  input: { borderWidth: 1, borderColor: paper.line, borderRadius: paper.radiusSm, minHeight: 50, padding: 12, fontSize: 17, color: paper.text, backgroundColor: paper.surface, fontFamily: font.body },
  primary: { minHeight: 50, borderRadius: paper.radiusSm, backgroundColor: paper.accent, alignItems: 'center', justifyContent: 'center', padding: 12 }, primaryText: { color: paper.onAccent, fontSize: 17, fontFamily: font.bodySemi },
  secondary: { minHeight: 48, padding: 12, alignItems: 'center', justifyContent: 'center' }, secondaryText: { color: paper.accent, fontFamily: font.bodySemi, fontSize: 15 }, disabled: { opacity: 0.45 }, notice: { padding: 14, backgroundColor: paper.warnSoft, color: paper.warn, fontSize: 16, borderRadius: paper.radiusSm, overflow: 'hidden' },
});
