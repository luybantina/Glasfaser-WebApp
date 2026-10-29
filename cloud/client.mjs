import {clone,equal,merge,diff,apply} from './shared.mjs';
import {installUsers} from './users.mjs';

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
  const status=text=>{label.textContent=text;};
  const download=(data,name='Glasfaser_Cloud_Local.gfb')=>{
    const url=URL.createObjectURL(new Blob([JSON.stringify({format:'GFB-1',appVersion:'43.1',createdAt:new Date().toISOString(),data},null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  button('Сохранить копию',()=>download(bridge.get()));
  button('Повторить',()=>sync());
  const logoutButton=button('Выйти',async()=>{
    await sync();
    if(diff(base,bridge.get()).length||conflicted){status('Сначала отправьте изменения или сохраните локальную копию.');return;}
    await api('/api/logout',{method:'POST'});
    localStorage.removeItem('gfdb');sessionStorage.removeItem('gf_session_user');location.href='/';
  });
  document.body.append(bar);

  const editing=()=>!!document.querySelector('#modal .modal')||['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName);
  function persist() {
    const current=clone(bridge.get());
    if(equal(current,base)){localStorage.removeItem(pendingKey);return;}
    try{originalSet.call(localStorage,pendingKey,JSON.stringify({base,data:current,revision}));}
    catch{status('Не удалось сохранить локальную копию. Скачайте её кнопкой справа.');}
  }
  function install(data,render=true) {
    suppress=true;
    try{bridge.set(clone(data));if(render)bridge.render();}finally{suppress=false;}
  }
  async function api(path,options={}) {
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),20000);
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
  async function sync() {
    if(busy||conflicted||editing())return;
    busy=true;
    try {
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
    }catch(error){persist();status(error.auth?error.message:`Нет синхронизации: ${error.message}`);}
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
  Storage.prototype.setItem=function(key,value) {
    const result=originalSet.call(this,key,value);
    if(this===localStorage&&key==='gfdb'&&!suppress){queueMicrotask(persist);status('Изменения сохранены на устройстве; ожидают отправки');clearTimeout(retryTimer);retryTimer=setTimeout(sync,300);}
    return result;
  };
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
}
