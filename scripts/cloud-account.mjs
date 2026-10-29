import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {options,root} from './cloud-cli.mjs';
const opts=options();
if(!/^[a-f0-9]{32}$/.test(opts['account-id']||''))throw new Error('Provide --account-id with the destination account ID');
const account={account_id:opts['account-id'],name:'glasfaser-migration-setup',compatibility_date:'2026-10-28'};
await writeFile(join(root,'wrangler.account.json'),JSON.stringify(account,null,2)+'\n',{flag:'wx'});
console.log('Created wrangler.account.json for resource creation in the destination account. No remote resources changed.');
