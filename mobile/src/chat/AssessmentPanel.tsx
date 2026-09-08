import { useState } from 'react';
import { Linking, Text, TextInput, View } from 'react-native';
import { copy } from './copy';
import { hasUnsentDetails, quickReplyLabels } from './protocol';
import type { Intake } from './useIntake';
import { Action, Check, QuickReply, styles } from './ui';

export function AssessmentPanel({ intake }: { readonly intake: Intake }) {
  const [referenceError, setReferenceError] = useState(false);
  const text = copy[intake.locale];
  const assessment = intake.assessment;
  if (!assessment) return null;
  const quickReplies = quickReplyLabels(intake.locale);
  const quickReplyDisabled = intake.busy || intake.requiresReattach || (intake.files.length > 0 && !intake.consent);
  if (assessment.safety.level === 'emergency') return <View style={styles.warning} accessibilityLiveRegion="assertive">
    <Text style={styles.heading}>{text.emergency}</Text><Text style={styles.danger}>{assessment.safety.guidance}</Text><Text style={styles.body}>{text.emergencyHelp}</Text>
  </View>;
  return <View style={styles.section}>
    {assessment.safety.guidance ? <View style={styles.warning}><Text style={styles.body}>{assessment.safety.guidance}</Text></View> : null}
    {!assessment.readyToConfirm && assessment.questions.length === 0 ? <Text style={styles.body} accessibilityLiveRegion="polite">{intake.locale === 'en' ? 'Tell me more about the symptom and when it happens. If helpful, you can also add a clearer photo or short video; attachments are optional.' : 'Cuénteme más sobre el síntoma y cuándo ocurre. Si le sirve, puede agregar una foto más clara o un video corto; los archivos son opcionales.'}</Text> : null}
    {assessment.questions.map((question, index) => <View key={question.id} style={index === 0 ? styles.questionSection : styles.section}>
      {index === 0 ? <View style={styles.questionBubble}>
        <Text style={[styles.body, { fontWeight: '600' }]}>{question.prompt}</Text>
        {question.requiredForSafety ? <Text style={styles.muted}>{text.required}</Text> : null}
      </View> : <>
      <Text style={styles.body}>{question.prompt}</Text>
      {question.requiredForSafety ? <Text style={styles.muted}>{text.required}</Text> : <Check label={text.skip} checked={intake.skips.includes(question.id)} disabled={intake.busy} onPress={() => intake.toggleSkip(question.id)} />}
      </>}
      {index === 0 ? <>
        <View style={styles.quickReplies}>
          {quickReplies.map(label => <QuickReply key={label} label={label} disabled={quickReplyDisabled} onPress={() => { void intake.analyze(label); }} />)}
        </View>
        {!question.requiredForSafety ? <Check label={text.skip} checked={intake.skips.includes(question.id)} disabled={intake.busy} onPress={() => intake.toggleSkip(question.id)} /> : null}
      </> : null}
    </View>)}
    {intake.skips.length > 0 ? <View style={styles.warning}>
      <Text style={styles.body}>{text.skipWarning}</Text>
      <Check label={text.skipAck} checked={intake.skipAck} disabled={intake.busy} onPress={() => intake.setSkipAck(!intake.skipAck)} />
      <Action label={text.skipContinue} disabled={intake.busy || !intake.skipAck || (intake.files.length > 0 && !intake.consent)} onPress={() => { void intake.analyze('', intake.skips); }} />
    </View> : null}
    {assessment.uncertaintyWarning ? <Text style={styles.muted}>{text.skipWarning}</Text> : null}
    {assessment.issueCandidates.length > 0 ? <View style={styles.section}>
      <Text style={styles.heading}>{text.possible}</Text><Text style={styles.muted}>{text.provisional}</Text>
      {assessment.issueCandidates.map(issue => <View key={issue.id} style={styles.separator}>
        <Check label={issue.label} checked={intake.selected.includes(issue.id)} disabled={intake.busy} onPress={() => intake.toggleIssue(issue.id)} />
        <Text style={styles.body}>{issue.reason}</Text>
        {issue.evidenceNeeded.map((detail, index) => <Text key={`${issue.id}-${index}`} style={styles.muted}>{detail}</Text>)}
      </View>)}
    </View> : null}
    {assessment.references?.length ? <View style={styles.section}>
      <Text style={styles.heading}>{intake.locale === 'en' ? 'Related references' : 'Referencias relacionadas'}</Text>
      {assessment.references.map(reference => <Action key={reference.url} label={reference.title} onPress={() => { setReferenceError(false); void Linking.openURL(reference.url).catch((error: unknown) => { if (error instanceof Error) setReferenceError(true); else throw error; }); }} />)}
      {referenceError ? <Text style={styles.danger}>{intake.locale === 'en' ? 'This link could not be opened. Please try again.' : 'No se pudo abrir este enlace. Inténtelo de nuevo.'}</Text> : null}
    </View> : null}
    {assessment.readyToConfirm ? <View style={styles.section}>
      <Text style={styles.heading}>{text.review}</Text>
      <Text style={styles.body}>{text.name}</Text>
      <TextInput accessibilityLabel={text.name} value={intake.name} onChangeText={intake.setName} editable={!intake.busy} autoComplete="name" maxLength={120} style={styles.input} />
      <Text style={styles.body}>{text.address}</Text>
      <TextInput accessibilityLabel={text.address} value={intake.address} onChangeText={intake.setAddress} editable={!intake.busy} autoComplete="street-address" maxLength={500} multiline style={styles.input} />
      <Check label={text.uncertainty} checked={intake.warningAck} disabled={intake.busy} onPress={() => intake.setWarningAck(!intake.warningAck)} />
      <Action label={text.confirm} primary disabled={hasUnsentDetails(intake.draft) || intake.busy || intake.requiresReattach || (intake.files.length > 0 && !intake.consent) || !intake.warningAck || !intake.selected.length || !intake.name.trim() || intake.address.trim().length < 3 || intake.translationsDirty} onPress={() => { void intake.confirm(); }} />
      {hasUnsentDetails(intake.draft) ? <Text style={styles.muted}>{intake.locale === 'en' ? 'Send your new details before confirming so they are included.' : 'Envíe los nuevos detalles antes de confirmar para incluirlos.'}</Text> : null}
      <Text style={styles.muted}>{text.noPayment}</Text>
    </View> : null}
  </View>;
}
