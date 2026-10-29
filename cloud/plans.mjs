/* Muffenspleißpläne (PDF per Schacht).
   The application keeps them in the browser database IndexedDB "gf_files" / store "splice" (one device only).
   This module makes them shared without changing the application:
   - the file goes to the cloud file store (/api/files), a small record to the shared list db.splicePlans;
   - every device copies missing plans into its own IndexedDB, uploads new ones and removes deleted ones. */
const DBN='gf_files',STORE='splice',KNOWN='gf_plans_known';
const TYPES=['application/pdf','image/jpeg','image/png','image/webp','image/gif'];

export function startPlans({bridge,api,sha256,notify}) {
  let internal=false,busy=false,timer=null;
  const pendingDeletes=new Set();
  const loadKnown=()=>{try{return new Set(JSON.parse(localStorage.getItem(KNOWN)||'[]'));}catch{return new Set();}};
  const saveKnown=set=>{try{localStorage.setItem(KNOWN,JSON.stringify([...set]));}catch{}};

  function open() {
    return new Promise((resolve,reject)=>{
      const r=indexedDB.open(DBN,1);
      r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(STORE))r.result.createObjectStore(STORE,{keyPath:'schachtId'});};
      r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
    });
  }
  async function run(mode,fn) {
    const d=await open();
    return new Promise((resolve,reject)=>{
      const tx=d.transaction(STORE,mode),store=tx.objectStore(STORE),req=fn(store);
      tx.oncomplete=()=>{d.close();resolve(req&&req.result);};
      tx.onerror=()=>{d.close();reject(tx.error);};
    });
  }
  const localAll=()=>run('readonly',s=>s.getAll());
  const localPut=rec=>{internal=true;return run('readwrite',s=>s.put(rec)).finally(()=>{internal=false;});};
  const localDelete=id=>{internal=true;return run('readwrite',s=>s.delete(id)).finally(()=>{internal=false;});};

  /* writes made by the application itself are detected here */
  const originalPut=IDBObjectStore.prototype.put,originalDelete=IDBObjectStore.prototype.delete;
  const ours=store=>{try{return store.name===STORE&&store.transaction.db.name===DBN;}catch{return false;}};
  IDBObjectStore.prototype.put=function(){
    const r=originalPut.apply(this,arguments);
    if(!internal&&ours(this))r.addEventListener('success',()=>schedule(500));
    return r;
  };
  IDBObjectStore.prototype.delete=function(key){
    const r=originalDelete.apply(this,arguments);
    if(!internal&&ours(this))r.addEventListener('success',()=>{pendingDeletes.add(String(key));schedule(500);});
    return r;
  };

  const plansOf=data=>Array.isArray(data.splicePlans)?data.splicePlans:(data.splicePlans=[]);
  const touch=()=>{try{if(typeof save==='function')save();}catch{}};
  const typeOf=rec=>{
    const t=rec.blob&&rec.blob.type;
    if(TYPES.includes(t))return t;
    return /\.pdf$/i.test(rec.fileName||'')?'application/pdf':'';
  };
  async function upload(rec) {
    const type=typeOf(rec);if(!type||!rec.blob)return null;
    const bytes=new Uint8Array(await rec.blob.arrayBuffer());
    if(!bytes.length||bytes.length>20000000)return null;
    const fileId=await sha256(bytes);
    await api(`/api/files?id=${fileId}&type=${encodeURIComponent(type)}`,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:bytes},180000);
    return {fileId,type};
  }

  async function syncPlans() {
    if(busy)return;busy=true;
    try {
      const data=bridge.get(),cloud=plansOf(data),known=loadKnown();let changed=false,localChanged=false;
      /* 1. deletions made on this device */
      for(const id of [...pendingDeletes]) {
        pendingDeletes.delete(id);known.delete(id);
        const i=cloud.findIndex(p=>p.id===id);
        if(i>=0){cloud.splice(i,1);changed=true;}
      }
      const local=await localAll(),byId=new Map(local.map(r=>[r.schachtId,r]));
      /* 2. cloud -> this device */
      for(const c of cloud.slice()) {
        const l=byId.get(c.id);
        if(l&&(l.fileId===c.fileId||String(l.savedAt||'')>=String(c.savedAt||''))){known.add(c.id);continue;}
        try {
          const resp=await fetch(`/api/files/${c.fileId}`,{credentials:'same-origin',cache:'no-store'});
          if(!resp.ok)continue;
          const blob=await resp.blob();
          await localPut({schachtId:c.id,schachtName:c.schachtName||'',fileName:c.fileName||'plan.pdf',size:blob.size,savedAt:c.savedAt||new Date().toISOString(),blob:new Blob([blob],{type:c.type||blob.type||'application/pdf'}),fileId:c.fileId});
          known.add(c.id);localChanged=true;
        }catch{}
      }
      /* 3. this device -> cloud (new or re-uploaded) / removed elsewhere */
      for(const l of local) {
        const c=cloud.find(p=>p.id===l.schachtId);
        if(c&&(c.fileId===l.fileId||String(c.savedAt||'')>=String(l.savedAt||'')))continue;
        if(!c&&known.has(l.schachtId)){await localDelete(l.schachtId);known.delete(l.schachtId);localChanged=true;continue;}
        const up=await upload(l).catch(()=>null);if(!up)continue;
        const entry={id:l.schachtId,schachtId:l.schachtId,schachtName:l.schachtName||'',fileName:l.fileName||'',size:l.size||0,savedAt:l.savedAt||new Date().toISOString(),fileId:up.fileId,type:up.type};
        const i=cloud.findIndex(p=>p.id===entry.id);
        if(i>=0)cloud[i]=entry;else cloud.push(entry);
        known.add(entry.id);changed=true;
      }
      saveKnown(known);
      if(changed)touch();
      if(localChanged&&notify)notify();
    }catch(e){console.warn('plans sync',e);}
    finally{busy=false;}
  }
  function schedule(ms){clearTimeout(timer);timer=setTimeout(syncPlans,ms);}
  setInterval(()=>{if(!document.hidden)syncPlans();},20000);
  schedule(4000);
  return {syncPlans};
}
