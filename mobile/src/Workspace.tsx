import { useEffect, useMemo, useState } from 'react';
import { AppState, View, Text } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { z } from 'zod';
import { NativeChat } from './chat/NativeChat';
import { Action, MotionView, SpecStrip, styles } from './chat/ui';
import { RequestsScreen } from './requests/RequestsScreen';
import { ManagementScreen } from './manage/ManagementScreen';
import { AccountScreen } from './platform/AccountScreen';
import { get } from './platform/api';
import { createForegroundRefreshController } from './platform/securityState';
import { paymentUiEnabled } from './config';
import { capabilitiesSchema } from './requests/contracts';
import { setSkinRole, skin } from './theme';

const meSchema = z.object({ actor: z.object({ id: z.string().min(1), role: z.enum(['customer', 'provider', 'operator']) }) });

export function Workspace({ accessToken, onSignOut }: { readonly accessToken: string; readonly onSignOut: () => void }) {
  const [tab, setTab] = useState<'chat'|'requests'|'manage'|'account'>('chat');
  const [locale,setLocale] = useState<'en'|'es'>('en');
  const [role,setRole] = useState<'customer'|'provider'|'operator'>('customer');
  const [actorId,setActorId] = useState('');
  const [paymentsLive,setPaymentsLive] = useState(false);
  const [ready,setReady] = useState(false); const [error,setError] = useState('');
  const refreshController = useMemo(() => createForegroundRefreshController({
    refresh: async () => {
      const me = await get('/api/me',accessToken,meSchema);
      const capabilities = await get('/api/capabilities',accessToken,capabilitiesSchema).catch(() => null);
      return { me, capabilities };
    },
    onSuccess: result => {
      const nextRole = result.me.actor.role;
      setActorId(result.me.actor.id);
      setRole(nextRole);
      setPaymentsLive(result.capabilities ? paymentUiEnabled(result.capabilities) : false);
      setTab(current => nextRole === 'customer'
        ? current === 'chat' || current === 'requests' || current === 'account' ? current : 'chat'
        : current === 'account' ? 'account' : 'manage');
      setReady(true); setError('');
    },
    onFailure: caught => { setActorId(''); setReady(false); setError(caught instanceof Error?caught.message:'Connection failed'); },
  }, AppState.currentState === 'active'), [accessToken]);
  useEffect(()=>{setReady(false);setError('');void refreshController.retry();const subscription=AppState.addEventListener('change',state=>{void refreshController.setAppState(state);});return()=>{subscription.remove();refreshController.dispose();};},[refreshController]);
  setSkinRole(role);
  const es=locale==='es';
  const homeTab = role === 'customer' ? 'chat' : 'manage';
  return <View style={[styles.flex, styles.safe]}>
    <StatusBar style={skin[role].dark ? 'light' : 'dark'}/>
    {!ready ? <View style={styles.content}><Text style={styles.heading}>WeCover</Text><Text style={styles.body}>{error||(es?'Conectando…':'Connecting…')}</Text><Action label={es?'Reintentar':'Retry'} onPress={()=>void refreshController.retry()}/><Action label={es?'Cerrar sesión':'Sign out'} onPress={onSignOut}/></View> : <>
      <SpecStrip role={role} es={es} paymentsLive={paymentsLive}/>
      <MotionView key={tab} style={styles.flex}>
        {tab==='chat' && role==='customer' ? <NativeChat accessToken={accessToken} onSignOut={onSignOut} preferredLocale={locale} onLocaleChange={setLocale}/> :
          tab==='requests' && role==='customer' ? <RequestsScreen accessToken={accessToken} locale={locale} onBack={()=>setTab(homeTab)}/> :
          tab==='manage' && role!=='customer' ? <ManagementScreen accessToken={accessToken} actorId={actorId} locale={locale} role={role} onBack={()=>setTab(homeTab)}/> :
          tab==='account' ? <AccountScreen accessToken={accessToken} locale={locale} onBack={()=>setTab(homeTab)}/> :
          null}
      </MotionView>
      <View style={styles.tabBar}>
        {role==='customer' ? <>
          <Action icon="chatbubble-ellipses-outline" label={es?'Chat':'Chat'} primary={tab==='chat'} onPress={()=>setTab('chat')}/>
          <Action icon="list-outline" label={es?'Solicitudes':'Requests'} primary={tab==='requests'} onPress={()=>setTab('requests')}/>
        </> : <Action icon="briefcase-outline" label={role==='operator' ? (es?'Administración':'Admin') : (es?'Trabajo':'Work')} primary={tab==='manage'} onPress={()=>{setTab('manage');void refreshController.retry();}}/>}
        <Action icon="person-circle-outline" label={es?'Cuenta':'Account'} primary={tab==='account'} onPress={()=>setTab('account')}/>
        <Action icon="language-outline" label={es?'EN':'ES'} onPress={()=>setLocale(es?'en':'es')}/>
        {role!=='customer'?<Action label={es?'Salir':'Sign out'} onPress={onSignOut}/>:null}
      </View>
    </>}
  </View>;
}
