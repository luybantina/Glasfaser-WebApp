import {clone,equal,merge,diff,apply} from './shared.mjs';
import {installUsers} from './users.mjs';
import {startPlans} from './plans.mjs';

export async function start(boot,bridge) {
  const tabId=sessionStorage.gfCloudTab||(sessionStorage.gfCloudTab=crypto.randomUUID());
  const pendingKey=`gfcloud_pending:${boot.user.id}:${tabId}`;
  let base=clone(boot.data),revision=boot.revision,busy=false,conflicted=false,suppress=false;
  let retryTimer;
  const originalSet=Storage.prototype.setItem;
  const bar=document.createElement('div');
  bar.id='gf-cloud-status';
  bar.style.cssText='position:fixed;bottom:8px;right:8px;z-index:2001;background:#17324d;color:white;border-radius:9px;padding:9px 12px;font:13px system-ui;max-width:90vw;box-shadow:0 2px 10px #0003;display:flex;align-items:center;gap:10px;flex-wrap:wrap';
  const label=document.createElement('span');bar.append(label);
  const button=(text,action,parent=bar)=>{const b=document.createElement('button');b.textContent=text;b.style.cssText='cursor:pointer;font:inherit;padding:5px 8px;border:1px solid #abbccc;border-radius:5px;background:white;color:#17324d';b.onclick=action;parent.append(b);return b;};
  const status=text=>{label.textContent=text;bar.style.background=/Облако: всё сохранено/.test(text)?'#17324d':'#8a3b12';};
  /* Nothing of the database is kept in the browser: the app's own localStorage 'gfdb' reads/writes go to memory only. */
  let memDb=JSON.stringify(boot.data);
  const originalGet=Storage.prototype.getItem,originalRemove=Storage.prototype.removeItem;
  try{originalRemove.call(localStorage,'gfdb');}catch{}
  // Old patches also put their own wrapper directly on `localStorage` (own property), which bypasses the prototype:
  // keep it as the underlying function and take its place as well.
  const baseSet=Object.getOwnPropertyDescriptor(localStorage,'setItem')?.value||originalSet;
  const guardedSet=function(key,value) {
    if(this===localStorage&&key==='gfdb') {
      memDb=String(value);
      if(!suppress){status('Изменения ещё не отправлены в облако — не закрывайте страницу');clearTimeout(retryTimer);retryTimer=setTimeout(sync,300);}
      return;
    }
    return baseSet.call(this,key,value);
  };
  Storage.prototype.setItem=guardedSet;
  if(Object.getOwnPropertyDescriptor(localStorage,'setItem'))localStorage.setItem=guardedSet;
  Storage.prototype.getItem=function(key) {
    if(this===localStorage&&key==='gfdb')return memDb;
    return originalGet.call(this,key);
  };
  Storage.prototype.removeItem=function(key) {
    if(this===localStorage&&key==='gfdb'){memDb=undefined;return;}
    return originalRemove.call(this,key);
  };
  /* PDF/photos are uploaded to their own cloud table; the record keeps only the address /api/files/<id>. */
  const DATA_URL=/^data:(image\/(?:jpeg|png|webp|gif)|application\/pdf);base64,([A-Za-z0-9+/]+={0,2})$/;
  const sha256=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
  /* PDF: pages are re-rendered as JPEG (about 170 dpi, quality 0.78) and rebuilt into a smaller PDF.
     Used only when it saves at least 30%; otherwise (text PDFs, small files, any error) the original is kept. */
  const PDF_MIN_BYTES=800000;
  const loadScript=src=>new Promise((resolve,reject)=>{
    const existing=document.querySelector(`script[data-gf-src="${src}"]`);
    if(existing){existing.addEventListener('load',resolve);if(existing.dataset.done)resolve();return;}
    const s=document.createElement('script');s.src=src;s.dataset.gfSrc=src;s.onload=()=>{s.dataset.done='1';resolve();};s.onerror=()=>reject(new Error('script '+src));document.head.append(s);
  });
  async function compressPdf(bytes) {
    if(bytes.length<PDF_MIN_BYTES)return null;
    try{
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
      await loadScript('https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js');
      const pdfjs=window.pdfjsLib;pdfjs.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      const source=await pdfjs.getDocument({data:bytes.slice()}).promise;
      if(source.numPages>40)return null;
      const out=await window.PDFLib.PDFDocument.create();
      for(let n=1;n<=source.numPages;n++) {
        const page=await source.getPage(n),base=page.getViewport({scale:1});
        const scale=Math.min(2.4,2000/Math.max(base.width,base.height));
        const canvas=document.createElement('canvas'),view=page.getViewport({scale});
        canvas.width=Math.round(view.width);canvas.height=Math.round(view.height);
        const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
        await page.render({canvasContext:ctx,viewport:view}).promise;
        const jpg=await out.embedJpg(await new Promise(r=>canvas.toBlob(r,'image/jpeg',0.78)).then(b=>b.arrayBuffer()));
        const target=out.addPage([base.width,base.height]);target.drawImage(jpg,{x:0,y:0,width:base.width,height:base.height});
        canvas.width=canvas.height=0;
      }
      const result=await out.save();
      return result.length<=bytes.length*0.7?result:null;
    }catch(error){console.warn('PDF compression skipped',error);return null;}
  }
  async function externalize() {
    const found=[],stack=[bridge.get()];
    while(stack.length) {
      const node=stack.pop();
      if(!node||typeof node!=='object')continue;
      if(typeof node.dataUrl==='string'&&node.dataUrl.length>1000&&node.dataUrl.startsWith('data:')){found.push(node);continue;}
      for(const key in node){const v=node[key];if(v&&typeof v==='object')stack.push(v);}
    }
    for(const node of found) {
      const original=node.dataUrl,match=DATA_URL.exec(original);
      if(!match)continue;
      let bytes=Uint8Array.from(atob(match[2]),c=>c.charCodeAt(0));
      if(match[1]==='application/pdf'){
        status('Облако: сжатие PDF…');
        const smaller=await Promise.race([compressPdf(bytes),new Promise(resolve=>setTimeout(()=>resolve(null),60000))]);
        if(smaller){bytes=smaller;if(typeof node.size==='number')node.size=bytes.length;}
      }
      const id=await sha256(bytes);
      status('Облако: загрузка файла…');
      await api(`/api/files?id=${id}&type=${encodeURIComponent(match[1])}`,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:bytes},180000);
      if(node.dataUrl===original)node.dataUrl=`/api/files/${id}`;
    }
  }
  const download=(data,name='Glasfaser_Cloud_Local.gfb')=>{
    const url=URL.createObjectURL(new Blob([JSON.stringify({format:'GFB-1',appVersion:'43.1',createdAt:new Date().toISOString(),data},null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  button('Сохранить копию',()=>download(bridge.get()));
  button('Повторить',()=>sync());
  const logoutButton=button('Выйти',async()=>{
    await sync();
    await flushAudit();
    if(diff(base,bridge.get()).length||conflicted){status('Сначала отправьте изменения или сохраните локальную копию.');return;}
    await api('/api/logout',{method:'POST'});
    localStorage.removeItem('gfdb');sessionStorage.removeItem('gf_session_user');location.href='/';
  });
  document.body.append(bar);
  if(boot.env==='staging') {
    const banner=document.createElement('div');
    banner.textContent='ТЕСТОВАЯ СРЕДА — данные здесь не рабочие';
    banner.style.cssText='position:fixed;top:0;left:0;right:0;z-index:2002;background:#b42318;color:white;text-align:center;font:600 12px system-ui;padding:3px;pointer-events:none';
    document.body.append(banner);
  }

  const editing=()=>!!document.querySelector('#modal .modal')||['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName);
  function persist() {
    // Unsent changes are no longer written to the browser; only old leftovers are cleaned up.
    try{localStorage.removeItem(pendingKey);}catch{}
  }
  function install(data,render=true) {
    suppress=true;
    try{bridge.set(clone(data));if(render)bridge.render();}finally{suppress=false;}
  }
  async function api(path,options={},timeoutMs=20000) {
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const response=await fetch(path,{...options,credentials:'same-origin',cache:'no-store',signal:controller.signal});
      if(response.status===401)throw Object.assign(new Error('Сеанс истёк. Сохраните копию изменений и войдите снова.'),{auth:true});
      const data=await response.json();
      if(!response.ok)throw Object.assign(new Error(data.error||'Не удалось синхронизировать.'),{status:response.status});
      return data;
    }finally{clearTimeout(timeout);}
  }
  function showConflicts(oldBase,local,remote,conflicts) {
    conflicted=true;status('Конфликт изменений — выберите значения.');persist();
    const overlay=document.createElement('div');
    overlay.style.cssText='position:fixed;inset:0;z-index:3000;background:#17324dcc;display:grid;place-items:center;padding:16px';
    const panel=document.createElement('div');panel.style.cssText='background:white;color:#17324d;border-radius:12px;padding:24px;width:min(800px,92vw);max-height:80vh;overflow:auto;font:15px system-ui';
    const h=document.createElement('h2');h.textContent='Одно поле изменено на разных устройствах';panel.append(h);
    const p=document.createElement('p');p.textContent='Выберите значение для каждого поля. Остальные изменения уже объединены. Ничего не отправляется до вашего выбора.';panel.append(p);
    const selections={};
    conflicts.forEach((item,index)=>{
      const row=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent=item.path;row.append(legend);
      for(const [kind,title] of [['local','На этом устройстве'],['remote','В облаке']]) {
        const option=document.createElement('label');option.style.cssText='display:block;padding:8px;overflow-wrap:anywhere';
        const radio=document.createElement('input');radio.type='radio';radio.name=`conflict${index}`;radio.onchange=()=>{selections[item.path]=kind;};
        const value=item[kind]===undefined?'Удалено':JSON.stringify(item[kind]);
        option.append(radio,document.createTextNode(`${title}: ${value.slice(0,500)}${value.length>500?'…':''}`));row.append(option);
      }
      panel.append(row);
    });
    button('Скачать полную локальную копию',()=>download(local),panel);
    button('Применить выбор',()=>{
      if(Object.keys(selections).length!==conflicts.length){p.textContent='Выберите значение для каждого поля.';return;}
      const resolved=merge(oldBase,local,remote.data,'',[],selections);
      base=clone(remote.data);revision=remote.revision;conflicted=false;overlay.remove();install(resolved);persist();sync();
    },panel);
    overlay.append(panel);document.body.append(overlay);
  }
  // While a form is open the screen must not be redrawn, but our own saved changes can still be sent.
  async function pushOnly() {
    let operations=diff(base,bridge.get());
    while(operations.length) {
      status(`Облако: отправка изменений (${operations.length})…`);
      const chunk=operations.slice(0,40);
      let result;
      try{result=await api('/api/changes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision,operations:chunk})});}
      catch(error){if(error.status===409){status('В облаке есть новые данные — объединятся после закрытия окна');return;}throw error;}
      base=apply(base,chunk);revision=result.revision;
      operations=diff(base,bridge.get());
    }
    status('Облако: всё сохранено');
  }
  /* shared activity log: entries produced on this device are sent to the cloud (the data sync never waits for this) */
  async function flushAudit() {
    const A=window.__gfAudit;if(!A||A.busy)return;
    if(!A.queue.length){if(A.afterFlush){const f=A.afterFlush;A.afterFlush=null;f();}return;}
    A.busy=true;
    try {
      while(A.queue.length) {
        const chunk=A.queue.slice(0,100);
        try{await api('/api/audit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({entries:chunk})});}
        catch(error){if(error.status===400){A.queue.splice(0,chunk.length);continue;}throw error;} // a rejected batch is dropped, it must not block the queue
        A.queue.splice(0,chunk.length);
      }
      if(A.afterFlush){const f=A.afterFlush;A.afterFlush=null;f();}
    }catch(error){/* retried on the next tick */}
    finally{A.busy=false;}
  }
  window.addEventListener('pagehide',()=>{
    const A=window.__gfAudit;
    if(A&&A.queue.length&&navigator.sendBeacon){try{navigator.sendBeacon('/api/audit',new Blob([JSON.stringify({entries:A.queue.slice(0,100)})],{type:'application/json'}));}catch{}}
  });
  /* A focused field (filter, search) must not stop other people's changes from arriving: they are merged into the data
     without redrawing; the screen is redrawn as soon as the field is left. With a form window open nothing is applied. */
  const modalOpen=()=>!!document.querySelector('#modal .modal');
  let needRender=false;
  async function pullQuiet() {
    if(modalOpen())return;
    const latest=await api('/api/revision');
    if(latest.revision===revision)return;
    const remote=await api('/api/state');
    if(modalOpen())return;
    const local=clone(bridge.get()),oldBase=clone(base),conflicts=[];
    const merged=merge(oldBase,local,remote.data,'',conflicts);
    if(conflicts.length)return; // decided after the field is left
    base=clone(remote.data);revision=remote.revision;
    if(!equal(local,merged)){install(merged,false);needRender=true;}
  }
  setInterval(()=>{if(needRender&&!editing()){needRender=false;try{bridge.render();}catch{}}},700);
  async function sync() {
    flushAudit();
    if(busy||conflicted)return;
    busy=true;
    try {
      await externalize();
      if(editing()){await pushOnly();await pullQuiet();return;}
      let operations=diff(base,bridge.get());
      if(!operations.length) {
        const latest=await api('/api/revision');
        if(latest.revision===revision){status('Облако: всё сохранено');return;}
      }
      const remote=await api('/api/state');
      // A form may have opened while the network request was in flight.
      if(editing())return;
      const local=clone(bridge.get()),oldBase=clone(base),conflicts=[];
      const merged=merge(oldBase,local,remote.data,'',conflicts);
      if(conflicts.length){showConflicts(oldBase,local,remote,conflicts);return;}
      base=clone(remote.data);revision=remote.revision;
      if(!equal(local,merged))install(merged);
      persist();operations=diff(base,bridge.get());
      while(operations.length) {
        status(`Облако: отправка изменений (${operations.length})…`);
        const chunk=operations.slice(0,40);
        let result;
        try{result=await api('/api/changes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision,operations:chunk})});}
        catch(error){if(error.status===409){status('Облако изменилось; объединяю изменения…');retryTimer=setTimeout(sync,100);return;}throw error;}
        base=apply(base,chunk);revision=result.revision;persist();
        operations=diff(base,bridge.get());
        // Leave edits in progress intact; the next pass will send them.
        if(editing())break;
      }
      status(operations.length?'Ожидает отправки в облако':'Облако: всё сохранено');
    }catch(error){persist();status(error.auth?error.message:`Нет синхронизации: ${error.message}. Изменения НЕ сохранены — не закрывайте страницу.`);}
    finally{busy=false;}
  }

  const stored=localStorage.getItem(pendingKey);
  if(stored) {
    try{
      const pending=JSON.parse(stored),conflicts=[];
      const restored=merge(pending.base,pending.data,boot.data,'',conflicts);
      install(restored,false);
      if(conflicts.length)showConflicts(pending.base,pending.data,boot,conflicts);
    }catch{status('Не удалось прочитать локальные изменения. Сохраните копию перед продолжением.');throw new Error('Invalid local pending data');}
  }
  const otherKeys=Object.keys(localStorage).filter(k=>k.startsWith(`gfcloud_pending:${boot.user.id}:`)&&k!==pendingKey);
  if(otherKeys.length)button('Копии других вкладок',()=>{
    for(const key of otherKeys){const value=localStorage.getItem(key);if(value)download(JSON.parse(value).data,'Glasfaser_Pending_Tab.gfb');}
  });
  window.gfLogout316=()=>logoutButton.click();
  window.installUpdateFile=input=>{input.value='';status('Облачная версия обновляется централизованно. Локальные .gfu здесь не устанавливаются.');};
  // The server owns authentication. Existing UI still uses the same session user.
  window.gfLoginSubmit316=event=>{event?.preventDefault();location.href='/';return false;};
  window.addEventListener('beforeunload',event=>{if(diff(base,bridge.get()).length){persist();event.preventDefault();event.returnValue='';}});
  window.addEventListener('online',()=>sync());
  window.addEventListener('focus',()=>sync());
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)sync();});
  setInterval(()=>{if(!document.hidden)sync();},5000);
  installUsers(boot,bridge);persist();bridge.render();sync();
  startPlans({bridge,api,sha256});
}
