import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
export const root=fileURLToPath(new URL('../',import.meta.url));
const wrangler=fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js',import.meta.url));
export function run(args,{capture=false}={}) {
  try{return execFileSync(process.execPath,[wrangler,...args],{cwd:root,encoding:'utf8',maxBuffer:64*1024*1024,stdio:capture?['ignore','pipe','pipe']:'inherit',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});}
  catch{throw new Error('Wrangler failed. Check account, permissions and network. Captured database output was not printed.');}
}
export function options(argv=process.argv.slice(2)) {
  const result={};
  for(let i=0;i<argv.length;i+=2) {
    if(!argv[i].startsWith('--')||!argv[i+1]||argv[i+1].startsWith('--'))throw new Error('Expected --option value pairs');
    result[argv[i].slice(2)]=argv[i+1];
  }
  return result;
}
export const config=async path=>JSON.parse(await readFile(path,'utf8'));
export function rows(output) {
  const parsed=JSON.parse(output);
  if(!Array.isArray(parsed)||parsed.some(x=>x.success===false))throw new Error('Database query failed');
  return parsed.flatMap(x=>x.results||[]);
}
