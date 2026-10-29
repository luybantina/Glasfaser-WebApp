export function installUsers(boot,bridge) {
  const ru=()=>document.documentElement.lang==='ru'||localStorage.lang==='ru';
  const text=(a,b)=>ru()?a:b;
  const admin=()=>bridge.get().users.some(u=>u.id===boot.user.id&&u.role==='admin'&&!u.blocked);
  for(const name of ['gfUserPw372','gfUserPwSave372']) {
    const original=window[name];
    if(typeof original==='function')window[name]=function(...args){
      if(!admin()){window.uiNotice?.(text('Только администратор может менять пароли.','Nur Administratoren können Passwörter ändern.'));return;}
      return original.apply(this,args);
    };
  }
  const decorate=()=>{
    for(const row of document.querySelectorAll('#gfUsersCard314 .gf-user-row-314')) {
      const id=row.querySelector('[data-menu]')?.getAttribute('data-menu');
      const user=bridge.get().users.find(u=>u.id===id);
      const meta=row.querySelector('.gf-user-meta-314');
      if(!user||!meta)continue;
      const has=!!(user.hasPassword||user.passHash);
      let badge=meta.querySelector('.gfcloud-password-status');
      if(has&&!badge){badge=document.createElement('span');badge.className='gfcloud-password-status';badge.style.cssText='display:inline-block;margin-left:6px;padding:1px 8px;border-radius:999px;background:#ecfdf3;color:#067647;border:1px solid #abefc6;font-size:11.5px;font-weight:600';meta.append(badge);}
      if(!has&&badge)badge.remove();
      const label=text('пароль задан','Passwort gesetzt');
      if(has&&badge.textContent!==label)badge.textContent=label;
      const action=row.querySelector('.gf372-pw');if(action)action.hidden=!admin();
    }
    for(const id of ['gf372P1','gf372P2','gfUserPass314']) {
      const input=document.getElementById(id);
      if(!input||input.dataset.cloudReveal)continue;
      input.dataset.cloudReveal='1';
      const control=document.createElement('label');control.style.cssText='display:flex;align-items:center;gap:6px;font-size:13px;margin-top:7px;flex-direction:row';
      const check=document.createElement('input');check.type='checkbox';check.style.cssText='width:auto;padding:0;margin:0';
      check.onchange=()=>{input.type=check.checked?'text':'password';};
      control.append(check,document.createTextNode(text('Показать вводимый пароль','Eingegebenes Passwort anzeigen')));
      input.closest('label').after(control);
    }
    const box=document.querySelector('.gf372-pw-box');
    if(box&&!box.querySelector('.gfcloud-password-note')) {
      const note=document.createElement('p');note.className='gfcloud-password-note';note.style.cssText='color:#667085;font-size:13px;line-height:1.5';
      note.textContent=text('Текущий пароль хранится как хеш и не отображается. Здесь можно задать новый пароль.','Das aktuelle Passwort wird als Hash gespeichert und kann nicht angezeigt werden. Hier können Sie ein neues Passwort festlegen.');
      box.querySelector('.modal-actions')?.before(note);
    }
  };
  new MutationObserver(decorate).observe(document.getElementById('app'),{subtree:true,childList:true});
  const modal=document.getElementById('modal');if(modal)new MutationObserver(decorate).observe(modal,{subtree:true,childList:true});
  decorate();
}
