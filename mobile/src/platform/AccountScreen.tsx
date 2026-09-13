import { useEffect, useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import { z } from 'zod';
import { Action, styles } from '../chat/ui';
import { get, post } from './api';

const property = z.object({ id: z.string(), label: z.string(), address: z.string(), building_type: z.string() });
export function AccountScreen({ accessToken, locale, onBack }: { readonly accessToken: string; readonly locale: 'en' | 'es'; readonly onBack: () => void }) {
  const es = locale === 'es';
  const [properties, setProperties] = useState<z.infer<typeof property>[]>([]);
  const [label, setLabel] = useState(''); const [address, setAddress] = useState(''); const [zip, setZip] = useState('');
  const [buildingType, setBuildingType] = useState<'house' | 'condo' | 'apartment' | 'commercial'>('house');
  const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false);
  async function load() { const result = await get('/api/properties', accessToken, z.object({ properties: z.array(property) })); setProperties(result.properties); }
  useEffect(() => { void load().catch((error: unknown) => setNotice(error instanceof Error ? error.message : 'Connection failed')); }, [accessToken]);
  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true); setNotice('');
    try { await action(); setNotice(success); } catch (error) { setNotice(error instanceof Error ? error.message : es ? 'No se pudo guardar.' : 'Could not save.'); }
    finally { setBusy(false); }
  }
  return <ScrollView style={styles.safe} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <Action label={es ? 'Volver' : 'Back'} onPress={onBack}/><Text style={styles.title}>{es ? 'Sus propiedades y privacidad' : 'Your properties and privacy'}</Text>
    {properties.map(item => <View key={item.id} style={styles.bubble}><Text style={styles.heading}>{item.label}</Text><Text style={styles.body}>{item.address}</Text></View>)}
    <TextInput style={styles.input} accessibilityLabel={es ? 'Nombre de la propiedad' : 'Property name'} placeholder={es ? 'Nombre de la propiedad' : 'Property name'} value={label} onChangeText={setLabel}/>
    <TextInput style={styles.input} accessibilityLabel={es ? 'Dirección con código postal' : 'Address including ZIP'} placeholder={es ? 'Dirección con código postal' : 'Address including ZIP'} value={address} onChangeText={setAddress}/>
    <TextInput style={styles.input} accessibilityLabel={es ? 'Código postal' : 'ZIP code'} placeholder={es ? 'Código postal' : 'ZIP code'} value={zip} onChangeText={setZip} keyboardType="number-pad" maxLength={5}/>
    <View style={styles.row}>{(['house','condo','apartment','commercial'] as const).map(type => <Action key={type} label={es ? ({house:'Casa',condo:'Condominio',apartment:'Apartamento',commercial:'Comercial'})[type] : ({house:'House',condo:'Condo',apartment:'Apartment',commercial:'Commercial'})[type]} primary={buildingType===type} onPress={() => setBuildingType(type)}/>)}</View>
    <Action label={es ? 'Guardar propiedad' : 'Save property'} disabled={busy || !label.trim() || !address.trim() || zip.length!==5} onPress={() => void run(async () => { await post('/api/properties',accessToken,z.object({property}),{label,address,zip,buildingType}); await load(); setLabel('');setAddress('');setZip(''); },es?'Propiedad guardada.':'Property saved.')}/>
    <Text style={styles.heading}>{es ? 'Privacidad' : 'Privacy'}</Text>
    <Text style={styles.body}>{es ? 'Sus datos se usan para tramitar la solicitud y compartirla con técnicos elegibles. Puede solicitar la eliminación; los registros que deban conservarse se revisarán por separado.' : 'Your details are used to handle your request and share it with eligible technicians. You can request deletion; records that must be retained will be reviewed separately.'}</Text>
    <Action label={es ? 'Registrar mi consentimiento' : 'Record my consent'} disabled={busy} onPress={() => void run(() => post('/api/privacy/consent',accessToken,z.unknown(),{version:'2026-09-p0',accepted:true}),es?'Consentimiento registrado.':'Consent recorded.')}/>
    <Action label={es ? 'Solicitar eliminación de datos' : 'Request data deletion'} disabled={busy} onPress={() => Alert.alert(es?'Solicitar eliminación':'Request deletion',es?'Se enviará una solicitud para revisar la eliminación de sus datos.':'A request will be recorded to review deletion of your data.',[{text:es?'Cancelar':'Cancel',style:'cancel'},{text:es?'Solicitar':'Request',style:'destructive',onPress:()=>void run(()=>post('/api/privacy/deletion',accessToken,z.unknown(),{}),es?'Solicitud registrada.':'Request recorded.')}])}/>
    {notice ? <Text accessibilityLiveRegion="polite" style={styles.warning}>{notice}</Text> : null}
  </ScrollView>;
}
