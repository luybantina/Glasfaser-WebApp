import {readFile,mkdir,writeFile,copyFile} from 'node:fs/promises';
const source=await readFile(new URL('../index.html',import.meta.url),'utf8');
const oldStart="initializeUpdateRuntime().then(()=>{normalizeAddressLinks();drawNav();render()}).catch(()=>{normalizeAddressLinks();drawNav();render()});";
if(!source.includes(oldStart))throw new Error('Application startup changed; update cloud adapter before building.');
if(!source.includes("const _storedDb=localStorage.getItem(STORAGE_KEY)"))throw new Error('Database startup changed.');
let html=source.replace('<head>','<head><!--CLOUD_BOOTSTRAP--><script src="/cloud/audit-shim.js"></script>');
if(!html.includes('<!--CLOUD_BOOTSTRAP-->'))throw new Error('Missing head');
html=html.replace('const _storedDb=localStorage.getItem(STORAGE_KEY)','const _storedDb=JSON.stringify(window.__GF_CLOUD__.data)');
// Cloud versions are deployed centrally; ignore device-specific executable updates.
html=html.replace('extra=await gfLoadInstalledPatches()','extra=[]');
// Local-only user UI used the presence of a password hash as its status flag.
// In cloud mode hashes stay on the server; use the explicit public status.
html=html.replace(/(<script[^>]*id="gfBakedUpdates"[^>]*>)([\s\S]*?)(<\/script>)/,(_,open,raw,close)=>{
  const baked=JSON.parse(raw),patch=baked.patches.find(p=>p.to==='37.2');
  if(!patch||!patch.patch.includes('!u.passHash&&!has'))throw new Error('User password UI changed; update cloud adapter.');
  patch.patch=patch.patch.replaceAll('!u.passHash','!(u.hasPassword||u.passHash)').replaceAll('u.passHash&&','(u.hasPassword||u.passHash)&&').replaceAll('u.passHash?','(u.hasPassword||u.passHash)?').replaceAll('x=>x.passHash','x=>(x.hasPassword||x.passHash)');
  // The activity log is shared in the cloud (cloud/audit-shim.js): the text must not say "on this device".
  const audit=baked.patches.find(p=>p.to==='37.7');
  if(!audit||!audit.patch.includes('Записи хранятся на этом устройстве и не могут быть изменены из программы.')||!audit.patch.includes('Die Einträge liegen auf diesem Gerät und lassen sich im Programm nicht ändern.'))throw new Error('Activity log texts changed; update cloud adapter.');
  audit.patch=audit.patch.replace('Записи хранятся на этом устройстве и не могут быть изменены из программы.','Записи общие для всех сотрудников и устройств и не могут быть изменены из программы. Новые записи других сотрудников появляются после обновления страницы.').replace('Die Einträge liegen auf diesem Gerät und lassen sich im Programm nicht ändern.','Die Einträge sind für alle Mitarbeiter und Geräte gemeinsam und lassen sich im Programm nicht ändern. Neue Einträge anderer Mitarbeiter erscheinen nach dem Neuladen der Seite.');
  return open+JSON.stringify(baked).replace(/</g,'\\u003c')+close;
});
html=html.replace(oldStart,`(async()=>{
  await initializeUpdateRuntime();
  normalizeAddressLinks();drawNav();
  const {start}=await import('/cloud/client.mjs');
  await start(window.__GF_CLOUD__,{get:()=>db,set:value=>{db=value;localStorage.setItem(STORAGE_KEY,JSON.stringify(value))},render:()=>render()});
})().catch(error=>{console.error('Cloud startup failed',error);document.getElementById('app').textContent='Не удалось подключить облачную базу. Перезагрузите страницу; локальные изменения сохранены.';});`);
await mkdir(new URL('../dist/cloud/',import.meta.url),{recursive:true});
await writeFile(new URL('../dist/index.html',import.meta.url),html);
for(const file of ['client.mjs','shared.mjs','users.mjs','audit-shim.js'])await copyFile(new URL(`../cloud/${file}`,import.meta.url),new URL(`../dist/cloud/${file}`,import.meta.url));
console.log('Cloud application built. No backup data is included in static assets.');
