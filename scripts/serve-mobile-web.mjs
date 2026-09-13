/**
 * Expo 웹 번들 서빙 + /api·/supabase(인증/서명 미디어만 허용) 로컬 프록시.
 */
import express from 'express';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const app=express();
const port=Number(process.env.MOBILE_WEB_PORT??5195);
function proxy(prefix,targetPort) {
  return (req,res)=>{
    const upstream=http.request({hostname:'127.0.0.1',port:targetPort,path:req.originalUrl.slice(prefix.length)||'/',method:req.method,headers:{...req.headers,host:`127.0.0.1:${targetPort}`}},response=>{
      res.writeHead(response.statusCode??502,response.headers);response.pipe(res);
    });
    upstream.setTimeout(125000,()=>upstream.destroy());
    upstream.on('error',()=>{if(!res.headersSent)res.status(503).json({error:'local_service_unavailable'});else res.end();});
    req.on('aborted',()=>upstream.destroy());req.pipe(upstream);
  };
}
app.use('/api',proxy('',8787));
app.use('/supabase', (req,res,next) => {
  const authPath = /^\/auth\/v1\/(token|user|logout|signup|health|verify)\/?$/.test(req.path);
  const signedMedia = req.method === 'GET' && req.path.startsWith('/storage/v1/object/sign/');
  if (!authPath && !signedMedia) return res.status(404).json({error:'not_found'});
  next();
}, proxy('/supabase',56321));
const directory=fileURLToPath(new URL('../mobile/dist-web/',import.meta.url));
app.use(express.static(directory));
app.get('/{*path}',(_req,res)=>res.sendFile(`${directory}/index.html`));
app.listen(port,'127.0.0.1',()=>console.log(`WeCover app web preview: http://127.0.0.1:${port}`));
