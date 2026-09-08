import { useEffect, useMemo, useState } from 'react';
import { AppState, View, Text } from 'react-native';
import { z } from 'zod';
import { NativeChat } from './chat/NativeChat';
import { Action, MotionView, styles } from './chat/ui';
import { RequestsScreen } from './requests/RequestsScreen';
import { ManagementScreen } from './manage/ManagementScreen';
import { AccountScreen } from './platform/AccountScreen';
import { get } from './platform/api';
import { createForegroundRefreshController } from './platform/securityState';

export function Workspace({ accessToken, onSignOut }: { readonly accessToken: string; readonly onSignOut: () => void }) {
  const [tab, setTab] = useState<'chat'|'requests'|'manage'|'account'>('chat');
  const [locale,setLocale] = useState<'en'|'es'>('en');
  const [role,setRole] = useState<'customer'|'provider'|'operator'>('customer');
  const [ready,setReady] = useState(false); const [error,setError] = useState('');
  const refreshController = useMemo(() => createForegroundRefreshController({
    refresh: () => get('/api/me',accessToken,z.object({actor:z.object({role:z.enum(['customer','provider','operator'])})})),
    onSuccess: result => { setRole(result.actor.role); setReady(true); setError(''); },
    onFailure: caught => { setReady(false); setError(caught instanceof Error?caught.message:'Connection failed'); },
  }, AppState.currentState === 'active'), [accessToken]);
  useEffect(()=>{setReady(false);setError('');void refreshController.retry();const subscription=AppState.addEventListener('change',state=>{void refreshController.setAppState(state);});return()=>{subscription.remove();refreshController.dispose();};},[refreshController]);
  const es=locale==='es';
  return <View style={styles.flex}>
    {!ready ? <View style={styles.content}><Text style={styles.heading}>WeCover</Text><Text style={styles.body}>{error||(es?'Conectando…':'Connecting…')}</Text><Action label={es?'Reintentar':'Retry'} onPress={()=>void refreshController.retry()}/><Action label={es?'Cerrar sesión':'Sign out'} onPress={onSignOut}/></View> : <>
      <MotionView key={tab} style={styles.flex}>{tab==='chat'&&role==='customer'?<NativeChat accessToken={accessToken} onSignOut={onSignOut} preferredLocale={locale} onLocaleChange={setLocale}/> : tab==='requests'?<RequestsScreen accessToken={accessToken} locale={locale} onBack={()=>setTab('chat')}/> : tab==='account'?<AccountScreen accessToken={accessToken} locale={locale} onBack={()=>setTab('chat')}/>:<ManagementScreen accessToken={accessToken} locale={locale} role={role} onBack={()=>setTab('chat')}/>}</MotionView>
      <View style={[styles.row,{padding:8,justifyContent:'center'}]}>
        <Action label={role==='customer'?(es?'Chat':'Chat'):(es?'Trabajo':'Work')} primary={tab==='chat'} onPress={()=>setTab('chat')}/>
        {role==='customer'?<Action label={es?'Solicitudes':'Requests'} primary={tab==='requests'} onPress={()=>setTab('requests')}/>:null}
        <Action label={es?'Gestión':'Manage'} primary={tab==='manage'} onPress={()=>{setTab('manage');void refreshController.retry();}}/>
        <Action label={es?'Cuenta':'Account'} primary={tab==='account'} onPress={()=>setTab('account')}/>
        <Action label={es?'EN':'ES'} onPress={()=>setLocale(es?'en':'es')}/>
        {role!=='customer'?<Action label={es?'Salir':'Sign out'} onPress={onSignOut}/>:null}
      </View>
    </>}
  </View>;
}
