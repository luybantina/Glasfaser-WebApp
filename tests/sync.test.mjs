import test from 'node:test';
import assert from 'node:assert/strict';
import {clone,merge,diff,apply} from '../cloud/shared.mjs';
import {legacyHash,checkPassword,publicUser} from '../cloud/auth.mjs';

test('independent fields on the same record survive simultaneous saves',()=>{
  const base={works:[{id:'a',amount:1,date:'2026-10-28'}]};
  const local=clone(base),remote=clone(base),conflicts=[];
  local.works[0].amount=2;remote.works[0].date='2026-10-29';
  assert.deepEqual(merge(base,local,remote,'',conflicts),{works:[{id:'a',amount:2,date:'2026-10-29'}]});
  assert.equal(conflicts.length,0);
});
test('independent insertions, edits and deletions survive',()=>{
  const base={addresses:[{id:'a',city:'A'},{id:'b',city:'B'}]};
  const local={addresses:[{id:'a',city:'A'},{id:'c',city:'C'}]};
  const remote={addresses:[{id:'a',city:'Updated'},{id:'b',city:'B'},{id:'d',city:'D'}]};
  const conflicts=[],result=merge(base,local,remote,'',conflicts);
  assert.deepEqual(result.addresses.map(x=>x.id),['a','d','c']);
  assert.equal(result.addresses[0].city,'Updated');assert.equal(conflicts.length,0);
});
test('same-field conflicts require an explicit choice',()=>{
  const base={works:[{id:'a',amount:1}]},local={works:[{id:'a',amount:2}]},remote={works:[{id:'a',amount:3}]};
  const conflicts=[];merge(base,local,remote,'',conflicts);
  assert.equal(conflicts[0].path,'/works/a/amount');
  assert.equal(merge(base,local,remote,'',[],{'/works/a/amount':'remote'}).works[0].amount,3);
});
test('delete versus edit conflicts instead of resurrecting or discarding records',()=>{
  const conflicts=[];
  merge({works:[{id:'a',amount:1}]},{works:[]},{works:[{id:'a',amount:2}]},'',conflicts);
  assert.equal(conflicts[0].path,'/works/a');
});
test('changes made during an in-flight save remain pending',()=>{
  const base={works:[{id:'a',amount:1}]};
  const sent={works:[{id:'a',amount:2}]},latest={works:[{id:'a',amount:3}]};
  const acknowledged=apply(base,diff(base,sent));
  assert.equal(diff(acknowledged,latest)[0].value.amount,3);
});
test('an offline edit is merged against a newer server snapshot on reload',()=>{
  const base={settings319:{a:'old',b:'old'}};
  assert.deepEqual(merge(base,{settings319:{a:'local',b:'old'}},{settings319:{a:'old',b:'remote'}}),{settings319:{a:'local',b:'remote'}});
});
test('duplicate IDs are rejected rather than silently dropping data',()=>{
  assert.throws(()=>diff({}, {works:[{id:'a'},{id:'a'}]}),/duplicate/);
});
test('legacy credentials are verified on the server and blocked users cannot log in',()=>{
  const user={salt:'test-salt',passHash:legacyHash('test-password','test-salt')};
  assert.equal(checkPassword('test-password',user),true);
  assert.equal(checkPassword('wrong',user),false);
  assert.equal(checkPassword('test-password',{...user,blocked:true}),false);
});
test('public users report password status without exposing credentials',()=>{
  const safe=publicUser({id:'a',salt:'salt',passHash:'a'.repeat(64),hasPassword:false});
  assert.equal(safe.hasPassword,true);assert.equal(safe.passHash,undefined);assert.equal(safe.salt,undefined);
  assert.equal(publicUser({id:'b',hasPassword:true}).hasPassword,false);
});
