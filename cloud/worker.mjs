import {COLLECTIONS,LISTS,unpack} from './shared.mjs';
import {digest,checkPassword,publicUser} from './auth.mjs';

const HEADERS={'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','X-Frame-Options':'DENY'};
const json=(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers:{...HEADERS,'Content-Type':'application/json; charset=utf-8',...headers}});
const cookie=(token,age=43200)=>`gfcloud=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${age}`;
const esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};

function loginPage(message='') {
  return new Response(`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Glasfaser · Вход</title><style>body{font:16px system-ui;background:#17324d;display:grid;place-items:center;min-height:100vh;margin:0;color:#17324d}form{box-sizing:border-box;background:white;padding:32px;border-radius:16px;width:min(420px,94vw)}label{display:block;margin:18px 0}input,button{box-sizing:border-box;width:100%;font:inherit;padding:12px;border-radius:7px;border:1px solid #aaa;margin-top:5px}button{background:#17324d;color:white;cursor:pointer}p{line-height:1.5;color:#667085}.err{color:#b42318}</style><form action="/login" method="post"><small>FK DATENTECHNIK</small><h1>Glasfaser Cloud</h1><p>Общая база · Gemeinsame Datenbank</p><label>Логин / Login<input name="login" autocomplete="username" required maxlength="120"></label><label>Пароль / Passwort<input name="password" type="password" autocomplete="current-password" required maxlength="1024"></label><p class="err" role="alert">${esc(message)}</p><button>Войти / Anmelden</button><p>Используйте логин и пароль из приложения.</p></form></html>`,{headers:{...HEADERS,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"}});
}

async function authenticate(request,env) {
  const token=/(?:^|;\s*)gfcloud=([a-f0-9]{64})(?:;|$)/.exec(request.headers.get('Cookie')||'')?.[1];
  if(!token)return null;
  const row=await env.DB.prepare(`SELECT r.payload FROM sessions s JOIN records r ON r.collection='users' AND r.id=s.user_id WHERE s.token_hash=? AND s.expires>? AND json_extract(r.payload,'$.passHash')=s.credential_hash AND COALESCE(json_extract(r.payload,'$.blocked'),0)=0`).bind(digest(token),Date.now()).first();
  return row?JSON.parse(row.payload):null;
}
async function snapshot(env) {
  const [meta,rows]=await env.DB.batch([env.DB.prepare('SELECT revision FROM meta WHERE id=1'),env.DB.prepare('SELECT collection,id,payload FROM records ORDER BY rowid')]);
  const data=unpack(rows.results);
  data.users=data.users.map(publicUser);
  return {revision:meta.results[0].revision,data};
}
async function throttle(env,key,limit) {
  const now=Date.now();
  const row=await env.DB.prepare(`INSERT INTO login_attempts(bucket,attempts,expires) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN expires<? THEN 1 ELSE attempts+1 END,expires=CASE WHEN expires<? THEN excluded.expires ELSE expires END RETURNING attempts`).bind(digest(key),now+900000,now,now).first();
  if(row.attempts>limit)fail('Слишком много попыток. Повторите через 15 минут.',429);
}
async function login(request,env) {
  const form=await request.formData();
  const login=String(form.get('login')||'').trim().toLowerCase();
  const password=String(form.get('password')||'');
  if(!login||login.length>120||!password||password.length>1024)return loginPage('Неверный логин или пароль.');
  await throttle(env,`ip:${request.headers.get('CF-Connecting-IP')||'local'}`,50);
  await throttle(env,`login:${login}`,10);
  const row=await env.DB.prepare("SELECT payload FROM records WHERE collection='users' AND lower(json_extract(payload,'$.login'))=?").bind(login).first();
  const user=row?JSON.parse(row.payload):null;
  // Hash even for an unknown login to reduce timing differences.
  const valid=checkPassword(password,user||{salt:'missing-user',passHash:'0'.repeat(64)});
  if(!user||!valid)return loginPage('Неверный логин или пароль.');
  const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires<?').bind(Date.now()),
    env.DB.prepare('DELETE FROM login_attempts WHERE expires<?').bind(Date.now()),
    env.DB.prepare('INSERT INTO sessions(token_hash,user_id,credential_hash,expires) VALUES(?,?,?,?)').bind(digest(token),user.id,user.passHash,Date.now()+43200000)
  ]);
  return new Response(null,{status:303,headers:{...HEADERS,Location:'/', 'Set-Cookie':cookie(token)}});
}

// Attachments (PDF/photos) are binary values in the FILES KV namespace, addressed by the SHA-256 of the bytes.
// They are streamed in and out without any JavaScript decoding (the free plan allows only 10 ms CPU per request).
const FILE_TYPES=['image/jpeg','image/png','image/webp','image/gif','application/pdf'];
const FILE_MAX_BYTES=20000000;
const hex=buffer=>Array.from(new Uint8Array(buffer),x=>x.toString(16).padStart(2,'0')).join('');
async function filePost(request,env,user,url) {
  if(user.role==='viewer')fail('Нет прав на редактирование.',403);
  if(!env.FILES)fail('Хранилище файлов не подключено.',503);
  const bytes=await request.arrayBuffer(); // consume the body first so a rejected upload is not cut off mid-transfer
  const id=url.searchParams.get('id')||'',type=url.searchParams.get('type')||'';
  if(!/^[a-f0-9]{64}$/.test(id)||!FILE_TYPES.includes(type))fail('Invalid file');
  if(!bytes.byteLength||bytes.byteLength>FILE_MAX_BYTES)fail('Invalid file data');
  if(hex(await crypto.subtle.digest('SHA-256',bytes))!==id)fail('File checksum mismatch');
  await env.FILES.put(id,bytes,{metadata:{type}});
  return json({url:`/api/files/${id}`});
}
async function fileGet(env,id,head) {
  if(!env.FILES||!/^[a-f0-9]{64}$/.test(id))return json({error:'not_found'},404);
  const {value,metadata}=await env.FILES.getWithMetadata(id,{type:'stream'});
  if(!value||!FILE_TYPES.includes(metadata?.type))return json({error:'not_found'},404);
  return new Response(head?null:value,{headers:{'Content-Type':metadata.type,'Content-Disposition':'inline','Cache-Control':'private, max-age=31536000, immutable','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','X-Frame-Options':'SAMEORIGIN'}});
}

async function patch(request,env,user) {
  if(user.role==='viewer')fail('Нет прав на редактирование.',403);
  const {revision,operations}=await request.json();
  if(!Number.isSafeInteger(revision)||revision<0||!Array.isArray(operations)||!operations.length||operations.length>40)fail('Invalid change batch');
  const existingUsers=operations.some(op=>op.collection==='users')?new Set((await env.DB.prepare("SELECT id FROM records WHERE collection='users'").all()).results.map(x=>x.id)):new Set();
  const seen=new Set();
  for(const op of operations) {
    if(!COLLECTIONS.includes(op.collection)||typeof op.id!=='string'||!op.id.length||op.id.length>200)fail('Invalid record');
    if(!LISTS.includes(op.collection)&&op.id!=='root')fail('Invalid object ID');
    const key=JSON.stringify([op.collection,op.id]);
    if(seen.has(key))fail('Duplicate operation');seen.add(key);
    if(op.value!==null) {
      if(!op.value||Array.isArray(op.value)||typeof op.value!=='object'||JSON.stringify(op.value).length>1800000)fail('Invalid record value');
      if(LISTS.includes(op.collection)&&op.value.id!==op.id)fail('Record ID mismatch');
    }
    if(op.collection==='users') {
      if(user.role!=='admin')fail('Только администратор может менять пользователей.',403);
      if(op.id===user.id&&(!op.value||op.value.blocked||op.value.role!=='admin'))fail('Нельзя удалить, заблокировать или понизить свою учётную запись.',403);
      if(op.value) {
        delete op.value.hasPassword; // Computed from credentials, never trusted from a client.
        if(typeof op.value.login!=='string'||!op.value.login.trim()||op.value.login.length>120||!['admin','editor','viewer'].includes(op.value.role))fail('Invalid user');
        if('passHash' in op.value&&!/^[a-f0-9]{64}$/.test(op.value.passHash))fail('Invalid password hash');
        if('salt' in op.value&&(typeof op.value.salt!=='string'||!op.value.salt||op.value.salt.length>200))fail('Invalid salt');
        if(!existingUsers.has(op.id)&&(!op.value.salt||!op.value.passHash))fail('New user needs a password');
      }
    }
  }
  const commit=crypto.randomUUID();
  const statements=[env.DB.prepare('UPDATE meta SET revision=revision+1,commit_id=? WHERE id=1 AND revision=? RETURNING revision').bind(commit,revision)];
  for(const op of operations) {
    if(op.value===null)statements.push(env.DB.prepare('DELETE FROM records WHERE collection=? AND id=? AND (SELECT commit_id FROM meta WHERE id=1)=?').bind(op.collection,op.id,commit));
    else statements.push(env.DB.prepare(`INSERT INTO records(collection,id,payload) SELECT ?,?,? WHERE (SELECT commit_id FROM meta WHERE id=1)=? ON CONFLICT(collection,id) DO UPDATE SET payload=${op.collection==='users'?"json_patch(records.payload,excluded.payload)":"excluded.payload"}`).bind(op.collection,op.id,JSON.stringify(op.value),commit));
  }
  const ownPassword=operations.find(op=>op.collection==='users'&&op.id===user.id&&op.value?.passHash)?.value.passHash;
  const currentToken=/(?:^|;\s*)gfcloud=([a-f0-9]{64})(?:;|$)/.exec(request.headers.get('Cookie')||'')?.[1];
  if(ownPassword&&currentToken)statements.push(env.DB.prepare('UPDATE sessions SET credential_hash=? WHERE token_hash=? AND (SELECT commit_id FROM meta WHERE id=1)=?').bind(ownPassword,digest(currentToken),commit));
  const result=await env.DB.batch(statements);
  if(!result[0].results.length)return json({error:'revision_conflict'},409);
  return json({revision:revision+1});
}

export default {
  async fetch(request,env) {
    try {
      const url=new URL(request.url),path=url.pathname;
      if(!['GET','HEAD','POST'].includes(request.method))return json({error:'method_not_allowed'},405);
      if(request.method==='POST') {
        if(request.headers.get('Origin')!==url.origin)fail('Недопустимый источник запроса.',403);
        if(Number(request.headers.get('Content-Length')||0)>(path==='/api/files'?FILE_MAX_BYTES+1000:4000000))fail('Слишком большой запрос.',413);
      }
      if(path==='/login'&&request.method==='POST')return await login(request,env);
      const user=await authenticate(request,env);
      if(!user)return path.startsWith('/api/')?json({error:'login_required'},401):loginPage();
      if(path==='/api/logout'&&request.method==='POST') {
        const token=/(?:^|;\s*)gfcloud=([a-f0-9]{64})/.exec(request.headers.get('Cookie')||'')?.[1];
        if(token)await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(digest(token)).run();
        return json({ok:true},200,{'Set-Cookie':cookie('',0)});
      }
      if(path==='/api/state'&&request.method==='GET')return json(await snapshot(env));
      if(path==='/api/revision'&&request.method==='GET')return json(await env.DB.prepare('SELECT revision FROM meta WHERE id=1').first());
      if(path==='/api/changes'&&request.method==='POST')return await patch(request,env,user);
      if(path==='/api/files'&&request.method==='POST')return await filePost(request,env,user,url);
      if(path.startsWith('/api/files/')&&request.method!=='POST')return await fileGet(env,path.slice(11),request.method==='HEAD');
      if(path.startsWith('/api/'))return json({error:'not_found'},404);
      if(request.method!=='GET'&&request.method!=='HEAD')return json({error:'method_not_allowed'},405);
      if(path==='/'||path==='/index.html') {
        const asset=await env.ASSETS.fetch(new Request(new URL('/index.html',url),{method:'GET'}));
        if(asset.status!==200)fail('Файлы приложения временно недоступны.',503);
        const boot={...await snapshot(env),user:publicUser(user)};
        const script=`<script>window.__GF_CLOUD__=${JSON.stringify(boot).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029')};sessionStorage.setItem('gf_session_user',window.__GF_CLOUD__.user.id);</script>`;
        const template=await asset.text();
        if(!template.includes('<!--CLOUD_BOOTSTRAP-->'))fail('Неверная сборка облачного приложения.',503);
        const html=template.replace('<!--CLOUD_BOOTSTRAP-->',script);
        return new Response(request.method==='HEAD'?null:html,{headers:{...HEADERS,'Content-Type':'text/html; charset=utf-8'}});
      }
      const response=await env.ASSETS.fetch(request);
      return new Response(response.body,{status:response.status,headers:{...Object.fromEntries(response.headers),...HEADERS}});
    } catch(error) {
      // Never return SQL errors or request bodies, which may contain private data.
      return json({error:error.status?error.message:'Сервер временно недоступен. Изменения остаются на устройстве.'},error.status||503);
    }
  }
};
