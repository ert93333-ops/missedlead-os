/**
 * 배포/터널 대상 데모 스모크: 로그인→역할 확인→합성 이미지 인테이크 분석→리포트 저장.
 */
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import sharp from 'sharp';
const base=process.env.DEMO_TEST_URL ?? 'https://word-represented-lay-verse.trycloudflare.com';
const report={startedAt:new Date().toISOString(),base,checks:[],analyses:[]};
let token;
async function request(path,body,method=body?'POST':'GET') {
 const headers={...(token?{Authorization:`Bearer ${token}`}:{})};
 if(body && !(body instanceof FormData)) headers['Content-Type']='application/json';
 const response=await fetch(base+path,{method,headers,body:body instanceof FormData?body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(125000)});
 const data=await response.json().catch(()=>({error:'non_json_response'}));
 if(!response.ok) throw new Error(`${method} ${path}: HTTP ${response.status} ${data.error??'unknown_error'}`);
 return data;
}
try {
 const login=await request('/api/demo/login',{username:'test',password:'test'});token=login.access_token;assert.ok(token);
 const me=await request('/api/me');assert.equal(me.actor.role,'customer');report.checks.push('test login customer role');
 const capabilities=await request('/api/capabilities');assert.equal(capabilities.payments.enabled,false);report.checks.push('payments disabled');
 const png=await sharp({create:{width:32,height:32,channels:3,background:'#888888'}}).png().toBuffer();
 let history=[{role:'user',content:'This is a fictional test scenario: small drip at the kitchen sink P-trap drain joint ONLY while sink water drains, first noticed yesterday. Supply pipes stay dry; sink drains normally. No gas smell, smoke, sparks, electrical contact, standing water or flooding. I shut the faucet off and put a bucket underneath, leak stops completely. Ground-floor house; cabinet is clear and easily accessible. Please arrange a plumber tomorrow. Attached gray image is a synthetic upload test, NOT an actual photo of the fault; do not infer any visual evidence from it. I do not know the pipe brand or exact joint measurements.'}];
 let assessment;
 for(let round=0;round<Number(process.env.DEMO_MAX_ANALYSES ?? 3);round++) {
  const payload={locale:'en',history,mediaConsent:true};
  if(assessment) {
   payload.previousAssessmentToken=assessment.assessmentToken;
   const optional=assessment.questions.filter(q=>!q.requiredForSafety).map(q=>q.id);
   if(optional.length) payload.skipped={questionIds:optional,warningAcknowledged:true};
  }
  const form=new FormData();form.set('payload',JSON.stringify(payload));form.append('media',new Blob([png],{type:'image/png'}),'synthetic-gray.png');
  assessment=await request('/api/intake/analyze',form);
  report.analyses.push({round:round+1,category:assessment.category,readyToConfirm:assessment.readyToConfirm,questions:assessment.questions,issueCandidates:assessment.issueCandidates,reply:assessment.reply,referenceCount:assessment.references?.length??0,uncertaintyWarning:assessment.uncertaintyWarning??null});
  console.log(JSON.stringify(report.analyses.at(-1)));
  if(assessment.safety.level==='emergency') throw new Error('Unexpected emergency classification for explicit hazard denials; halted without retry');
  if(assessment.readyToConfirm) break;
  history=[...history,{role:'assistant',content:assessment.reply},{role:'user',content:'There is no gas smell, smoke, sparks, electrical exposure, structural damage or severe flooding. Only the drain joint drips when draining and stops when the faucet is off. Supply pipes are dry. I cannot provide more photos or measurements and choose to skip optional details. I understand missing details can change the suspected cause and estimate; a plumber must inspect to verify.'}];
 }
 assert.equal(assessment.readyToConfirm,true,'not ready after bounded three analyses');
 const confirmed=await request('/api/intake/confirm',{assessmentToken:assessment.assessmentToken,customerName:'Test customer',address:'Test home, Charlotte NC 28202',acceptedIssueIds:assessment.issueCandidates.map(i=>i.id),warningAcknowledged:true});
 report.confirmation=confirmed;assert.equal(confirmed.matchCount,3);report.checks.push('confirmed provisional scope with three matches');
 const requestId=confirmed.requestId;
 const dashboard=await request('/api/dashboard');
 const persisted=dashboard.requests.find(item=>item.id===requestId);
 assert.equal(new Set(persisted.providerIds).size,3);report.checks.push('dashboard persisted three distinct provider matches');
 const form=new FormData();form.set('assessmentToken',assessment.assessmentToken);form.append('media',new Blob([png],{type:'image/png'}),'synthetic-gray.png');
 await request(`/api/requests/${requestId}/intake-media`,form);
 const listed=await request(`/api/requests/${requestId}/intake-media`);assert.equal(listed.media.length,1);
 const signedUrl=new URL(listed.media[0].url,base);assert.equal(signedUrl.origin,new URL(base).origin);
 const image=await fetch(signedUrl,{signal:AbortSignal.timeout(30000)});assert.equal(image.status,200);assert.match(image.headers.get('content-type'),/^image\/png/);
 report.checks.push('same original image saved and public signed image returned 200');
 const repeat=new FormData();repeat.set('assessmentToken',assessment.assessmentToken);repeat.append('media',new Blob([png],{type:'image/png'}),'synthetic-gray.png');await request(`/api/requests/${requestId}/intake-media`,repeat);
 const dedup=await request(`/api/requests/${requestId}/intake-media`);assert.equal(dedup.media.length,1);report.checks.push('repeated original upload deduplicated');
 report.passed=true;
} catch(error) {report.passed=false;report.error=error.message;console.error(report.error);process.exitCode=1;}
finally {report.finishedAt=new Date().toISOString();await fs.mkdir('artifacts',{recursive:true});await fs.writeFile('artifacts/demo-chat-smoke.json',JSON.stringify(report,null,2)+'\n');}
