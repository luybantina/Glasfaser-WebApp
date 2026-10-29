import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {legacyHash} from '../cloud/auth.mjs';

let mf,db,cookie;
const origin='https://glasfaser.example';
const request=(path,options={})=>mf.dispatchFetch(origin+path,{...options,headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...options.headers}});
const state=async()=>{const r=await request('/api/state');assert.equal(r.status,200);return r.json();};
const change=(revision,operations)=>request('/api/changes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision,operations})});
before(async()=>{
  execFileSync(process.execPath,['scripts/build.mjs']);
  execFileSync(process.execPath,[fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js',import.meta.url)),'deploy','--dry-run','--outdir','.private/test-bundle'],{env:{...process.env,WRANGLER_SEND_METRICS:'false'},stdio:'pipe'});
  mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:'.private/test-bundle/worker.js',compatibilityDate:'2026-10-28',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],kvNamespaces:['FILES'],serviceBindings:{ASSETS:async req=>new Response(await readFile(new URL('../dist/index.html',import.meta.url),'utf8'),{headers:{'Content-Type':'text/html'}})}}));
  db=await mf.getD1Database('DB');
  const schema=await readFile(new URL('../cloud/migrations/0001.sql',import.meta.url),'utf8');
  for(const statement of schema.split(';').filter(x=>x.trim()))await db.prepare(statement).run();
  for(const user of [{id:'admin',login:'test-admin',role:'admin'},{id:'other',login:'test-other',role:'admin'},{id:'viewer',login:'test-viewer',role:'viewer'}]) {
    await db.prepare("INSERT INTO records VALUES('users',?,?)").bind(user.id,JSON.stringify({...user,salt:'test-salt',passHash:legacyHash('test-password','test-salt'),blocked:false})).run();
  }
});
after(async()=>{await mf?.dispose();});

test('unauthenticated users cannot access data or injected HTML',async()=>{
  const api=await request('/api/state');assert.equal(api.status,401);
  const html=await(await request('/')).text();assert.match(html,/Glasfaser Cloud/);assert.ok(!html.includes('test-admin'));
});
test('login uses HttpOnly secure cookies; data excludes password hashes',async()=>{
  const r=await request('/login',{method:'POST',body:new URLSearchParams({login:'test-admin',password:'test-password'}),redirect:'manual'});
  assert.equal(r.status,303);const set=r.headers.get('set-cookie');assert.match(set,/HttpOnly/);assert.match(set,/Secure/);
  cookie=set.split(';')[0];const s=await state();assert.equal(s.data.users.length,3);assert.equal(s.data.users[0].passHash,undefined);
  assert.equal(s.data.users[0].hasPassword,true);
  const html=await(await request('/')).text();assert.match(html,/window.__GF_CLOUD__/);assert.ok(!html.includes('<!--CLOUD_BOOTSTRAP-->'));assert.ok(!html.includes(legacyHash('test-password','test-salt')));
});
test('cross-origin mutations are rejected',async()=>{
  const r=await request('/api/changes',{method:'POST',headers:{Origin:'https://attacker.example'},body:'{}'});assert.equal(r.status,403);
});
test('a stale device cannot overwrite the current revision',async()=>{
  const initial=await state();
  const first=await change(initial.revision,[{collection:'works',id:'work1',value:{id:'work1',amount:1}}]);assert.equal(first.status,200);
  const stale=await change(initial.revision,[{collection:'works',id:'work1',value:{id:'work1',amount:999}}]);assert.equal(stale.status,409);
  assert.equal((await state()).data.works[0].amount,1);
});
test('simultaneous writes commit once and the other device gets a conflict',async()=>{
  const s=await state();
  const responses=await Promise.all([change(s.revision,[{collection:'works',id:'parallel1',value:{id:'parallel1'}}]),change(s.revision,[{collection:'works',id:'parallel2',value:{id:'parallel2'}}])]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
  assert.equal((await state()).data.works.filter(x=>x.id.startsWith('parallel')).length,1);
});
test('updating a sanitized user preserves server credentials',async()=>{
  const s=await state(),u=s.data.users.find(x=>x.id==='other');u.firstName='Updated';
  const r=await change(s.revision,[{collection:'users',id:'other',value:u}]);assert.equal(r.status,200);
  const row=await db.prepare("SELECT payload FROM records WHERE collection='users' AND id='other'").first();
  assert.equal(JSON.parse(row.payload).passHash,legacyHash('test-password','test-salt'));
});
test('admin cannot remove their own access',async()=>{
  const s=await state();assert.equal((await change(s.revision,[{collection:'users',id:'admin',value:null}])).status,403);
});
test('blocking a user revokes their existing session immediately',async()=>{
  const login=await request('/login',{method:'POST',body:new URLSearchParams({login:'test-other',password:'test-password'}),redirect:'manual'});
  const otherCookie=login.headers.get('set-cookie').split(';')[0];
  const s=await state(),u=s.data.users.find(x=>x.id==='other');u.blocked=true;
  assert.equal((await change(s.revision,[{collection:'users',id:'other',value:u}])).status,200);
  assert.equal((await request('/api/state',{headers:{Cookie:otherCookie}})).status,401);
});
test('viewer cannot write; a duplicate login rolls back the entire batch',async()=>{
  const login=await request('/login',{method:'POST',body:new URLSearchParams({login:'test-viewer',password:'test-password'}),redirect:'manual'});
  const viewerCookie=login.headers.get('set-cookie').split(';')[0];
  let s=await state();
  assert.equal((await request('/api/changes',{method:'POST',headers:{Cookie:viewerCookie,'Content-Type':'application/json'},body:JSON.stringify({revision:s.revision,operations:[{collection:'works',id:'bad',value:{id:'bad'}}]})})).status,403);
  const admin=s.data.users.find(x=>x.id==='admin');
  const r=await change(s.revision,[{collection:'works',id:'rollback',value:{id:'rollback'}},{collection:'users',id:'duplicate',value:{...admin,id:'duplicate',salt:'test-salt',passHash:legacyHash('test-password','test-salt')}}]);
  assert.equal(r.status,503);const after=await state();assert.equal(after.revision,s.revision);assert.ok(!after.data.works.find(x=>x.id==='rollback'));
});
test('admin can replace a user password; the old password and session stop working',async()=>{
  let s=await state(),u=s.data.users.find(x=>x.id==='other');u.blocked=false;
  assert.equal((await change(s.revision,[{collection:'users',id:u.id,value:u}])).status,200);
  const before=await request('/login',{method:'POST',body:new URLSearchParams({login:'test-other',password:'test-password'}),redirect:'manual'});
  const oldCookie=before.headers.get('set-cookie').split(';')[0];
  s=await state();u=s.data.users.find(x=>x.id==='other');u.salt='new-salt';u.passHash=legacyHash('replacement-password',u.salt);
  assert.equal((await change(s.revision,[{collection:'users',id:u.id,value:u}])).status,200);
  assert.equal((await request('/api/state',{headers:{Cookie:oldCookie}})).status,401);
  const wrong=await request('/login',{method:'POST',body:new URLSearchParams({login:'test-other',password:'test-password'}),redirect:'manual'});
  assert.equal(wrong.headers.get('set-cookie'),null);
  const good=await request('/login',{method:'POST',body:new URLSearchParams({login:'test-other',password:'replacement-password'}),redirect:'manual'});
  assert.equal(good.status,303);assert.ok(good.headers.get('set-cookie'));
});
test('changing own password preserves this session and revokes other sessions',async()=>{
  const another=await request('/login',{method:'POST',body:new URLSearchParams({login:'test-admin',password:'test-password'}),redirect:'manual'});
  const oldCookie=another.headers.get('set-cookie').split(';')[0];
  const s=await state(),u=s.data.users.find(x=>x.id==='admin');u.salt='own-salt';u.passHash=legacyHash('own-new-password',u.salt);
  assert.equal((await change(s.revision,[{collection:'users',id:u.id,value:u}])).status,200);
  assert.equal((await request('/api/state')).status,200);
  assert.equal((await request('/api/state',{headers:{Cookie:oldCookie}})).status,401);
  const safe=(await state()).data.users.find(x=>x.id==='admin');assert.equal(safe.hasPassword,true);assert.equal(safe.passHash,undefined);
});

const sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
const upload=(id,type,body,headers={})=>request(`/api/files?id=${id}&type=${encodeURIComponent(type)}`,{method:'POST',headers:{'Content-Type':'application/octet-stream',...headers},body});
test('attachments are stored separately, served only after login and verified by checksum',async()=>{
  const bytes=new Uint8Array(6*1024*1024);for(let i=0;i<bytes.length;i++)bytes[i]=(i*31+7)&255;
  const id=await sha(bytes);
  const ok=await upload(id,'application/pdf',bytes);assert.equal(ok.status,200);assert.equal((await ok.json()).url,`/api/files/${id}`);
  assert.equal((await upload(id,'application/pdf',bytes)).status,200); // idempotent
  const got=await request(`/api/files/${id}`);assert.equal(got.status,200);
  assert.equal(got.headers.get('content-type'),'application/pdf');assert.equal(got.headers.get('x-frame-options'),'SAMEORIGIN');
  assert.deepEqual(Buffer.from(await got.arrayBuffer()),Buffer.from(bytes));
  const anonymous=await mf.dispatchFetch(origin+`/api/files/${id}`);assert.equal(anonymous.status,401);
  assert.equal((await upload('0'.repeat(64),'application/pdf',bytes)).status,400); // wrong checksum
  assert.equal((await upload(id,'text/html',bytes)).status,400);                   // type not allowed
  assert.equal((await request('/api/files/'+'f'.repeat(64))).status,404);
});
test('a viewer cannot upload attachments',async()=>{
  const login=await request('/login',{method:'POST',body:new URLSearchParams({login:'test-viewer',password:'test-password'}),redirect:'manual'});
  const viewer=login.headers.get('set-cookie').split(';')[0],bytes=new TextEncoder().encode('hello');
  assert.equal((await upload(await sha(bytes),'image/png',bytes,{Cookie:viewer})).status,403);
});