import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {records} from '../cloud/shared.mjs';
const file=process.argv[2];
if(!file)throw new Error('Usage: node scripts/prepare-import.mjs /absolute/path/backup.gfb');
const backup=JSON.parse((await readFile(file,'utf8')).replace(/^\uFEFF/,''));
if(backup.format!=='GFB-1'||!backup.data)throw new Error('Unsupported backup format');
const data=backup.data;
if(!data.users?.some(x=>x.role==='admin'&&!x.blocked&&x.salt&&x.passHash))throw new Error('Backup must contain an active admin with a password.');
const rows=[...records(data).values()];
const quote=x=>`'${String(x).replace(/'/g,"''")}'`;
// Initial import only: abort instead of replacing an existing shared database.
let sql=`CREATE TABLE IF NOT EXISTS import_guard (id INTEGER PRIMARY KEY CHECK(id=1));\nINSERT INTO import_guard(id) SELECT 1 WHERE EXISTS(SELECT 1 FROM records);\nINSERT INTO import_guard(id) VALUES(1);\n`;
for(const row of rows) {
  const payload=JSON.stringify(row.value);
  if(Buffer.byteLength(payload)>1800000)throw new Error('A record exceeds the database row size limit');
  // D1 SQL files have a statement size limit; encode longer payloads in chunks.
  const chunks=payload.match(/[\s\S]{1,20000}/g)||[''];
  const value=chunks.map(quote).join(' || ');
  if(Buffer.byteLength(value)>95000)throw new Error('A record needs the large-file importer before deployment');
  sql+=`INSERT INTO records(collection,id,payload) VALUES(${quote(row.collection)},${quote(row.id)},${value});\n`;
}
sql+="UPDATE meta SET revision=1,commit_id='initial-import' WHERE id=1;\n";
await mkdir(new URL('../.private/',import.meta.url),{recursive:true,mode:0o700});
await writeFile(new URL('../.private/seed.sql',import.meta.url),sql,{mode:0o600});
console.log(`Prepared ${rows.length} records in .private/seed.sql (ignored by Git).`);
for(const [key,value] of Object.entries(data))if(Array.isArray(value))console.log(`${key}: ${value.length}`);
