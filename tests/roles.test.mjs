import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {legacyHash} from '../cloud/auth.mjs';
import {DEFAULT_ROLES,permsOf,checkOp,makeCtx,ALL_KEYS} from '../cloud/perms.mjs';

// ---- the rules themselves (no server) ----
const ctxOf=(role,id='u1',extra={})=>makeCtx({id,login:id,firstName:'Anna',lastName:id,role,...extra},DEFAULT_ROLES);
const termin=o=>({id:'t1',date:'2026-11-03',time:'10:00',timeEnd:'11:00',userId:'u2',userName:'Anna u2',addressId:'a1',items:[{workType:'NE4',amount:1}],done:false,...o});

test('admin has every right, an unknown role has none, old roles keep working',()=>{
  assert.equal(permsOf('admin',[]).size,ALL_KEYS.length);
  assert.equal(permsOf('no-such-role',[]).size,0);
  assert.ok(permsOf('editor',[]).has('work.editAll')&&!permsOf('editor',[]).has('settings.users'));
  assert.ok(permsOf('viewer',[]).has('work.page')&&!permsOf('viewer',[]).has('work.editAll'));
});
test('monteur: reassigns / closes / edits any meeting, creates and deletes only his own',()=>{
  const c=ctxOf('role_monteur','u1');
  const mt=termin();
  assert.equal(checkOp(c,{collection:'termine',id:'t1',value:{...mt,userId:'u1',userName:'Anna u1'}},mt),null);                       // reassign
  assert.equal(checkOp(c,{collection:'termine',id:'t1',value:{...mt,items:[{workType:'NE4',amount:2}]}},mt),null);                    // quantity
  assert.equal(checkOp(c,{collection:'termine',id:'t1',value:{...mt,items:[{workType:'NE4',amount:1,done:true,workId:'w1'}],done:true}},mt),null); // close
  assert.equal(checkOp(c,{collection:'termine',id:'n1',value:termin({id:'n1',userId:'u1'})},undefined),null);                          // create own
  assert.match(checkOp(c,{collection:'termine',id:'n2',value:termin({id:'n2',userId:'u2'})},undefined),/создание встреч/);             // create foreign
  assert.match(checkOp(c,{collection:'termine',id:'t1',value:null},mt),/удаление встреч/);                                            // delete foreign
  assert.equal(checkOp(c,{collection:'termine',id:'t1',value:null},termin({userId:'u1'})),null);                                       // delete own
});
test('monteur: own acts only, no dictionaries, address data (Home ID, WE) allowed',()=>{
  const c=ctxOf('role_monteur','u1');
  assert.equal(checkOp(c,{collection:'works',id:'w1',value:{id:'w1',performer:'Anna u1'}},undefined),null);
  assert.match(checkOp(c,{collection:'works',id:'w2',value:{id:'w2',performer:'Anna u2'}},undefined),/только на себя/);
  assert.match(checkOp(c,{collection:'works',id:'w3',value:null},{id:'w3',performer:'Anna u2'}),/только свои/);
  assert.match(checkOp(c,{collection:'pops',id:'p1',value:{id:'p1',name:'X'}},undefined),/справочник/);
  const a={id:'a1',street:'S',homeId:'',apartments:2};
  assert.equal(checkOp(c,{collection:'addresses',id:'a1',value:{...a,homeId:'A000011',apartments:3}},a),null);
  assert.match(checkOp(c,{collection:'addresses',id:'a1',value:{...a,street:'Other'}},a),/адрес/);
  assert.match(checkOp(c,{collection:'users',id:'x',value:{id:'x'}},undefined),/пользователи/);
});
test('assistenz: meetings fully, acts and documents not',()=>{
  const c=ctxOf('role_assistenz','u1');
  assert.equal(checkOp(c,{collection:'termine',id:'n2',value:termin({id:'n2',userId:'u2'})},undefined),null);
  assert.equal(checkOp(c,{collection:'termine',id:'t1',value:null},termin()),null);
  assert.match(checkOp(c,{collection:'works',id:'w1',value:{id:'w1',performer:'Anna u1'}},undefined),/актов/);
  assert.match(checkOp(c,{collection:'aufmassRegisters',id:'r1',value:{id:'r1'}},undefined),/Aufmaß/);
});
test('chef: all acts, documents only to look at, no settings',()=>{
  const c=ctxOf('role_chef','u1');
  assert.equal(checkOp(c,{collection:'works',id:'w1',value:{id:'w1',performer:'Anna u2'}},undefined),null);
  assert.match(checkOp(c,{collection:'aufmassRegisters',id:'r1',value:{id:'r1'}},undefined),/Aufmaß/);
  assert.match(checkOp(c,{collection:'roles',id:'x',value:{id:'x',name:'x',perms:{}}},undefined),/роли/);
});

// ---- the server ----
let mf,db;const origin='https://glasfaser.example';
const cookies={};
const request=(who,path,options={})=>mf.dispatchFetch(origin+path,{...options,headers:{Origin:origin,...(cookies[who]?{Cookie:cookies[who]}:{}),...options.headers}});
const state=async who=>(await request(who,'/api/state')).json();
const change=(who,revision,operations)=>request(who,'/api/changes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision,operations})});
before(async()=>{
  execFileSync(process.execPath,['scripts/build.mjs']);
  execFileSync(process.execPath,[fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js',import.meta.url)),'deploy','--dry-run','--outdir','.private/test-bundle'],{env:{...process.env,WRANGLER_SEND_METRICS:'false'},stdio:'pipe'});
  mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:'.private/test-bundle/worker.js',compatibilityDate:'2026-10-28',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],kvNamespaces:['FILES'],serviceBindings:{ASSETS:async()=>new Response('<html><!--CLOUD_BOOTSTRAP--></html>',{headers:{'Content-Type':'text/html'}})}}));
  db=await mf.getD1Database('DB');
  for(const f of ['0001.sql','0002.sql']) {
    const sql=await readFile(new URL('../cloud/migrations/'+f,import.meta.url),'utf8');
    for(const statement of sql.split(';').filter(x=>x.trim()))await db.prepare(statement).run();
  }
  const users=[{id:'admin',login:'adm',role:'admin'},{id:'mon',login:'mon',role:'role_monteur',firstName:'Max',lastName:'Mon'},{id:'ass',login:'ass',role:'role_assistenz',firstName:'Ass',lastName:'Ist'}];
  for(const user of users)await db.prepare("INSERT INTO records VALUES('users',?,?)").bind(user.id,JSON.stringify({...user,salt:'s',passHash:legacyHash('pw','s'),blocked:false})).run();
  for(const role of DEFAULT_ROLES)await db.prepare("INSERT INTO records VALUES('roles',?,?)").bind(role.id,JSON.stringify(role)).run();
  await db.prepare("INSERT INTO records VALUES('termine','t1',?)").bind(JSON.stringify(termin({id:'t1',userId:'ass'}))).run();
  await db.prepare("INSERT INTO records VALUES('termine','t2',?)").bind(JSON.stringify(termin({id:'t2',userId:'mon'}))).run();
  for(const [who,login] of [['admin','adm'],['mon','mon'],['ass','ass']]) {
    const r=await request(who,'/login',{method:'POST',body:new URLSearchParams({login,password:'pw'}),redirect:'manual'});
    cookies[who]=r.headers.get('set-cookie').split(';')[0];
  }
});
after(async()=>{await mf?.dispose();});

test('server: the monteur may reassign a foreign meeting but not delete it, not edit dictionaries',async()=>{
  let s=await state('mon');
  const t1=s.data.termine.find(x=>x.id==='t1');
  let r=await change('mon',s.revision,[{collection:'termine',id:'t1',value:{...t1,userId:'mon',userName:'Max Mon'}}]);assert.equal(r.status,200);
  s=await state('mon');
  r=await change('mon',s.revision,[{collection:'pops',id:'p9',value:{id:'p9',name:'X'}}]);assert.equal(r.status,403);
  r=await change('mon',s.revision,[{collection:'termine',id:'t1',value:null}]);assert.equal(r.status,200); // it is his own now
  s=await state('mon');
  r=await change('mon',s.revision,[{collection:'termine',id:'new1',value:termin({id:'new1',userId:'ass'})}]);assert.equal(r.status,403);
  r=await change('mon',s.revision,[{collection:'termine',id:'new2',value:termin({id:'new2',userId:'mon'})}]);assert.equal(r.status,200);
});
test('server: nobody but an administrator can make or change roles and administrators',async()=>{
  let s=await state('mon');
  let r=await change('mon',s.revision,[{collection:'roles',id:'role_x',value:{id:'role_x',name:'X',perms:{'settings.users':true}}}]);assert.equal(r.status,403);
  r=await change('mon',s.revision,[{collection:'users',id:'mon',value:{...s.data.users.find(u=>u.id==='mon'),role:'admin'}}]);assert.equal(r.status,403);
  s=await state('admin');
  r=await change('admin',s.revision,[{collection:'roles',id:'role_x',value:{id:'role_x',name:'X',perms:{'meet.page':true}}}]);assert.equal(r.status,200);
  s=await state('admin');
  r=await change('admin',s.revision,[{collection:'users',id:'ass',value:{...s.data.users.find(u=>u.id==='ass'),role:'role_x'}}]);assert.equal(r.status,200);
  r=await change('admin',s.revision+1,[{collection:'users',id:'ass',value:{...s.data.users.find(u=>u.id==='ass'),role:'no_such_role'}}]);assert.equal(r.status,400);
});
test('server: the assistant cannot write acts',async()=>{
  const s=await state('ass');
  const r=await change('ass',s.revision,[{collection:'works',id:'w9',value:{id:'w9',performer:'Ass Ist'}}]);assert.equal(r.status,403);
});
test('server: the administrator can create a user without a password (he cannot sign in yet)',async()=>{
  const s=await state('admin');
  const r=await change('admin',s.revision,[{collection:'users',id:'nopw',value:{id:'nopw',login:'nopw',firstName:'No',lastName:'Pw',role:'role_monteur',blocked:false}}]);
  assert.equal(r.status,200);
  const l=await request('x','/login',{method:'POST',body:new URLSearchParams({login:'nopw',password:''}),redirect:'manual'});
  assert.ok(!(l.headers.get('set-cookie')||'').includes('='));
});
