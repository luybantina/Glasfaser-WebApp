import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

test('migration configs isolate accounts; restore rejects the source and damaged backups',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'glasfaser-migration-'));
  try {
    await mkdir(join(dir,'scripts'));
    for(const file of ['cloud-cli.mjs','cloud-account.mjs','cloud-target.mjs','cloud-restore.mjs'])await copyFile(new URL('../scripts/'+file,import.meta.url),join(dir,'scripts',file));
    const source={name:'production',account_id:'1'.repeat(32),main:'cloud/worker.mjs',d1_databases:[{binding:'DB',database_name:'production',database_id:'11111111-1111-1111-1111-111111111111'}]};
    await writeFile(join(dir,'wrangler.jsonc'),JSON.stringify(source));
    const run=(file,args=[])=>spawnSync(process.execPath,[join(dir,'scripts',file),...args],{cwd:dir,encoding:'utf8'});
    const account=run('cloud-account.mjs',['--account-id','2'.repeat(32)]);assert.equal(account.status,0,account.stderr);
    assert.equal(JSON.parse(await readFile(join(dir,'wrangler.account.json'))).account_id,'2'.repeat(32));
    const args=['--account-id','2'.repeat(32),'--database-id','22222222-2222-2222-2222-222222222222','--name','migrated'];
    const target=run('cloud-target.mjs',args);assert.equal(target.status,0,target.stderr);
    const configured=JSON.parse(await readFile(join(dir,'wrangler.migration.json')));
    assert.equal(configured.account_id,'2'.repeat(32));assert.equal(configured.d1_databases[0].database_id,'22222222-2222-2222-2222-222222222222');
    assert.notEqual(run('cloud-target.mjs',args).status,0,'Must not overwrite existing migration config');
    assert.deepEqual(JSON.parse(await readFile(join(dir,'wrangler.jsonc'))),source);
    await writeFile(join(dir,'wrangler.migration.json'),JSON.stringify({...configured,d1_databases:source.d1_databases}));
    const denied=run('cloud-restore.mjs',['--backup','missing.gfb']);assert.notEqual(denied.status,0);assert.match(denied.stderr,/current production database/);
    await writeFile(join(dir,'wrangler.migration.json'),JSON.stringify(configured));
    await writeFile(join(dir,'damaged.gfb'),'{}');await writeFile(join(dir,'damaged.gfb.manifest.json'),JSON.stringify({sha256:'wrong'}));
    const corrupt=run('cloud-restore.mjs',['--backup','damaged.gfb']);assert.notEqual(corrupt.status,0);assert.match(corrupt.stderr,/SHA-256 mismatch/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
