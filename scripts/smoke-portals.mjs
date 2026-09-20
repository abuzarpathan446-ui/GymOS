import 'dotenv/config';
import assert from 'node:assert/strict';
const origin='http://127.0.0.1:3001';
const accounts=[['admin','admin@gymos.test','/admin/dashboard'],['owner','owner@gymos.test','/dashboard'],['staff','reception@gymos.test','/attendance'],['staff','trainer1@gymos.test','/workouts'],['member','member@gymos.test','/member/dashboard']];
for(const [portal,email,page] of accounts){
 const login=await fetch(`${origin}/api/${portal}/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:process.env.SEED_PASSWORD})});
 assert.equal(login.status,200,`${portal} login failed`);
 const cookie=login.headers.getSetCookie().map(c=>c.split(';')[0]).join('; '),session=await login.json();
 const result=await fetch(`${origin}/api${page}`,{headers:{Cookie:cookie}});assert.equal(result.status,200,`${portal} destination failed`);
 if(portal==='member'){
  const data=await result.json();assert.equal(data.member.name,'Aditya Kulkarni');
  for(const section of ['membership','attendance','workouts','progress','payments','appointments','qr']){
   const response=await fetch(`${origin}/api/member/${section}`,{headers:{Cookie:cookie}});assert.equal(response.status,200,section);
  }
 }
 const logout=await fetch(`${origin}/api/auth/logout`,{method:'POST',headers:{Cookie:cookie,'X-CSRF-Token':session.user.csrf_token}});assert.equal(logout.status,200);
 console.log(`OK ${portal}: ${email}`);
}
console.log('All four login portals and the linked demo member are working on the running server.');
