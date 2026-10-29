/* Shared activity log (Aktivitätsprotokoll). Runs before the application starts.
   The application keeps its log in localStorage['gf_audit377']. Here that key is served from the cloud log
   (administrators get everybody's entries) and every new entry is queued for upload (cloud/client.mjs sends the queue). */
(function(){
  const KEY='gf_audit377',boot=window.__GF_CLOUD__||{};
  const A=window.__gfAudit={queue:[],busy:false,afterFlush:null};
  let cache=[];
  try{
    if(boot.user&&boot.user.role==='admin'){
      const x=new XMLHttpRequest();x.open('GET','/api/audit?limit=3000',false);x.send();
      if(x.status===200){const j=JSON.parse(x.responseText);if(Array.isArray(j))cache=j.filter(e=>e&&e.id)}
    }
  }catch(e){}
  const known=new Set(cache.map(e=>e.id));
  const originalGet=Storage.prototype.getItem,originalSet=Storage.prototype.setItem,originalRemove=Storage.prototype.removeItem;
  /* entries written on this device before the log was shared */
  try{
    const raw=originalGet.call(localStorage,KEY);
    if(raw){
      const old=JSON.parse(raw);
      if(Array.isArray(old)){
        old.forEach(e=>{if(e&&e.id&&e.ts&&!known.has(e.id)){known.add(e.id);A.queue.push(e);cache.push(e)}});
        cache.sort((a,b)=>String(a.ts).localeCompare(String(b.ts)));
      }
      A.afterFlush=()=>{try{originalRemove.call(localStorage,KEY)}catch(e){}};
    }
  }catch(e){}
  Storage.prototype.getItem=function(key){
    if(this===localStorage&&key===KEY)return JSON.stringify(cache);
    return originalGet.call(this,key);
  };
  Storage.prototype.setItem=function(key,value){
    if(this===localStorage&&key===KEY){
      try{
        const arr=JSON.parse(value);
        if(Array.isArray(arr)){
          arr.forEach(e=>{if(e&&e.id&&!known.has(e.id)){known.add(e.id);A.queue.push(e)}});
          cache=arr;
        }
      }catch(e){}
      return;
    }
    return originalSet.call(this,key,value);
  };
})();
