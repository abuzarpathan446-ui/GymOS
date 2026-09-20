import 'dotenv/config';
const origin='http://127.0.0.1:3001';
const health=await fetch(`${origin}/health`);if(!health.ok)throw new Error('Health check failed');
const login=await fetch(`${origin}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'owner@gymos.test',password:process.env.SEED_PASSWORD})});
if(!login.ok)throw new Error('Development login failed');
const cookie=login.headers.getSetCookie().map(c=>c.split(';')[0]).join('; '),session=await login.json();
for(const path of ['/dashboard','/members','/membership-plans','/payments','/attendance','/trainers','/workouts','/progress','/leads','/appointments','/inventory','/notifications','/settings','/staff','/subscription','/reports?from=2026-01-01&to=2030-12-31']){
 const r=await fetch(`${origin}/api${path}`,{headers:{Cookie:cookie}});if(!r.ok)throw new Error(`${path}: ${r.status} ${await r.text()}`);console.log(`OK ${path}`);
}
const logout=await fetch(`${origin}/api/auth/logout`,{method:'POST',headers:{Cookie:cookie,'X-CSRF-Token':session.user.csrf_token}});if(!logout.ok)throw new Error('Logout failed');
console.log('Persistent-server smoke check passed.');
