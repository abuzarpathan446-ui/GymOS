import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../src/app.js';
import {allowedOrigins} from '../src/origins.js';
import {type Database} from '../src/db.js';
test('explicit LAN and localhost origins pass; foreign origins and spoofed Host remain blocked',async()=>{
 const previous={NODE_ENV:process.env.NODE_ENV,APP_ORIGIN:process.env.APP_ORIGIN,ALLOWED_ORIGINS:process.env.ALLOWED_ORIGINS};
 process.env.NODE_ENV='test';process.env.APP_ORIGIN='http://192.168.0.195:5173';process.env.ALLOWED_ORIGINS='http://localhost:5173/, http://127.0.0.1:5173';
 // Invalid login fields are rejected before the database, isolating the origin boundary.
 const db={query:async()=>{throw new Error('Unexpected DB access');}} as unknown as Database;
 const app=await createApp(db);
 try{
  for(const origin of ['http://192.168.0.195:5173','http://localhost:5173','http://127.0.0.1:5173']){
   const r=await app.inject({method:'POST',url:'/api/admin/auth/login',headers:{origin},payload:{}});
   assert.equal(r.statusCode,400,`${origin}: ${r.body}`);
  }
  for(const origin of ['https://evil.test','http://192.168.0.195:5174','http://localhost:5173.evil.test','null']){
   const r=await app.inject({method:'POST',url:'/api/admin/auth/login',headers:{origin,host:'evil.test'},payload:{}});
   assert.equal(r.statusCode,403,`${origin}: ${r.body}`);
  }
 }finally{await app.close();for(const [k,v] of Object.entries(previous))if(v===undefined)delete process.env[k];else process.env[k]=v;}
});
test('origin configuration fails closed for wildcards, credentials and paths',()=>{
 for(const value of ['*','null','http://trusted.test/path','https://user:secret@trusted.test','file:///tmp/app'])assert.throws(()=>allowedOrigins({APP_ORIGIN:value}));
 assert.deepEqual([...allowedOrigins({APP_ORIGIN:'https://gym.example',ALLOWED_ORIGINS:''})],['https://gym.example']);
});
