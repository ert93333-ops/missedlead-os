import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
config({path:['.env.local','.env'],quiet:true,override:true});
if(process.env.DEMO_MODE!=='true') throw new Error('DEMO_MODE must explicitly be true');
const url=process.env.SUPABASE_URL; const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url || !key) throw new Error('Supabase server configuration missing');
const endpoint=new URL(url);
if(!['127.0.0.1','localhost'].includes(endpoint.hostname)||endpoint.port!=='56321')throw new Error('Refusing non-project demo database');
const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
const ready=await client.rpc('demo_seed_ready');
if(ready.error || ready.data!==true) throw new Error('Apply and verify demo isolation migration before seeding');
const email='test@demo.wecover.invalid';
const password=process.env.DEMO_CUSTOMER_PASSWORD || randomBytes(48).toString('base64url');
if(password.length<32) throw new Error('Demo backend password must be strong');
const users=[];
for(let page=1;;page++) { const result=await client.auth.admin.listUsers({page,perPage:1000}); if(result.error) throw new Error('Unable to inspect demo accounts'); users.push(...result.data.users); if(result.data.users.length<1000) break; }
async function account(address,name,role) {
 const existing=users.find(user=>user.email===address);
 if(existing && existing.app_metadata.demo!==true) throw new Error('Existing non-demo account collision');
 const attrs={email:address,password:role==='customer'?password:randomBytes(48).toString('base64url'),email_confirm:true,app_metadata:{demo:true},user_metadata:{display_name:name}};
 const result=existing?await client.auth.admin.updateUserById(existing.id,attrs):await client.auth.admin.createUser(attrs);
 if(result.error || !result.data.user) throw new Error('Demo account creation failed');
 const profile={id:result.data.user.id,role,display_name:name,is_demo:true};
 if(role==='provider') Object.assign(profile,{organization_name:name,provider_status:'approved',license_verified:true,license_expires_at:'2099-01-01T00:00:00Z',insurance_verified:true,insurance_expires_at:'2099-01-01T00:00:00Z',service_categories:['plumbing','hvac','handyman'],service_areas:['Charlotte','28202']});
 const saved=await client.from('profiles').upsert(profile); if(saved.error) throw new Error('Demo profile setup failed');
}
await account(email,'Test customer','customer');
for(let i=1;i<=3;i++) await account('technician'+i+'@demo.wecover.invalid','Fictional test technician '+i,'provider');
let local='';try {local=await readFile('.env.local','utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
for(const [name,value] of Object.entries({DEMO_CUSTOMER_EMAIL:email,DEMO_CUSTOMER_PASSWORD:password})) {
 const line=name+'='+value; const pattern=new RegExp('^'+name+'=.*$','m'); local=pattern.test(local)?local.replace(pattern,line):local+'\n'+line+'\n';
}
await writeFile('.env.local',local,{mode:0o600});
console.log('Demo customer and 3 fictional technicians seeded. Restart API to load ignored local credentials. No payments or dispatch performed.');
