/**
 * 데모 로그인 엔드포인트 POST /api/demo/login. DEMO_MODE=true + 고정 자격증명(test/test)
 * + env의 데모 고객 계정으로 실제 Supabase 세션을 발급한다. 데모 플래그/고객 역할 검증 후 토큰 반환.
 */
import { createClient } from '@supabase/supabase-js';
import type { Express } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
const credentials = z.object({username:z.literal('test'),password:z.literal('test')}).strict();
const config = z.object({SUPABASE_URL:z.string().url(),SUPABASE_ANON_KEY:z.string().min(1),DEMO_CUSTOMER_EMAIL:z.string().email(),DEMO_CUSTOMER_PASSWORD:z.string().min(6)});
export function registerDemoRoutes(app: Express) {
 const limiter = rateLimit({windowMs:60_000,limit:10,keyGenerator:()=>"shared-demo-login",standardHeaders:'draft-8',legacyHeaders:false,message:{error:'demo_login_rate_limited'}});
 app.post('/api/demo/login', (req,res,next) => {
  res.setHeader('Cache-Control','no-store');
  if(process.env.DEMO_MODE !== 'true') {res.status(404).json({error:'not_found'});return;}
  limiter(req,res,next);
 }, async(req,res) => {
  if(!credentials.safeParse(req.body).success) {res.status(401).json({error:'invalid_demo_credentials'});return;}
  const parsed = config.safeParse(process.env);
  if(!parsed.success) {res.status(503).json({error:'demo_not_configured'});return;}
  const env = parsed.data;
  const client = createClient(env.SUPABASE_URL,env.SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  try {
   const {data,error} = await client.auth.signInWithPassword({email:env.DEMO_CUSTOMER_EMAIL,password:env.DEMO_CUSTOMER_PASSWORD});
   if(error || !data.session || data.user?.app_metadata.demo !== true) {res.status(503).json({error:'demo_unavailable'});return;}
   const profile = await client.from('profiles').select('role,is_demo').eq('id',data.user.id).single();
   if(profile.error || profile.data?.role !== 'customer' || profile.data?.is_demo !== true) {res.status(503).json({error:'demo_unavailable'});return;}
   res.json({access_token:data.session.access_token,refresh_token:data.session.refresh_token});
  } catch {res.status(503).json({error:'demo_unavailable'});}
 });
}
