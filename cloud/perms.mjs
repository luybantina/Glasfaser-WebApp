// Roles and access rights. One file for the server (it enforces the rights) and for the browser (it hides what a role must not use
// and takes back changes that would be refused anyway). build.mjs also makes a plain-script copy of this file (perms-global.js).
//
// A role is a record {id,name,perms:{key:true,...}} of the list "roles". The role with the id "admin" is built in: it can do everything
// and is not stored. Old accounts with the roles "editor" / "viewer" keep working (see LEGACY).

export const PERM_GROUPS = [
  {id:'meet', ru:'Главная и встречи', de:'Startseite und Termine', items:[
    ['dash.allTab','Вкладка «Все встречи» на главной (встречи всех сотрудников)','Reiter „Alle Termine“ auf der Startseite'],
    ['dash.teamBox','Окно «Команда сегодня» на главной (количество встреч по сотрудникам)','Fenster „Team heute“ auf der Startseite'],
    ['meet.page','Раздел «Встречи» (страница со всеми функциями)','Bereich „Termine“'],
    ['meet.create','Создавать встречи любому сотруднику','Termine für jeden Mitarbeiter anlegen'],
    ['meet.createOwn','Создавать встречи себе (в том числе на главном экране)','Termine für sich selbst anlegen'],
    ['meet.edit','Редактировать встречи (дата, время, адрес, WE, количество работ)','Termine bearbeiten (Datum, Zeit, Adresse, WE, Mengen)'],
    ['meet.reassign','Изменять исполнителя встречи','Mitarbeiter eines Termins ändern'],
    ['meet.close','Закрывать встречи («Выполнено»)','Termine abschließen („Erledigt“)'],
    ['meet.delete','Удалять любые встречи','Beliebige Termine löschen'],
    ['meet.deleteOwn','Удалять свои встречи','Eigene Termine löschen']
  ]},
  {id:'project', ru:'Проект', de:'Projekt', items:[
    ['project.page','Раздел «Проект» (просмотр)','Bereich „Projekt“ (ansehen)'],
    ['project.edit','Раздел «Проект»: изменять','Bereich „Projekt“: ändern']
  ]},
  {id:'dict', ru:'Справочники (POP, шахты, адреса, кабели, LB, услуги)', de:'Verzeichnisse (POP, Schächte, Adressen, Kabel, LB, Leistungen)', items:[
    ['dict.page','Справочники: просмотр','Verzeichnisse: ansehen'],
    ['dict.edit','Справочники: изменять, импортировать, удалять','Verzeichnisse: ändern, importieren, löschen']
  ]},
  {id:'work', ru:'Работы / акты', de:'Arbeiten / Akte', items:[
    ['work.page','Раздел «Работы»: просмотр всех актов','Bereich „Arbeiten“: alle Akte ansehen'],
    ['work.editOwn','Акты: создавать и изменять свои','Akte: eigene anlegen und ändern'],
    ['work.editAll','Акты: создавать и изменять любые','Akte: beliebige anlegen und ändern']
  ]},
  {id:'doc', ru:'Документы (Aufmaß, реестры)', de:'Dokumente (Aufmaß, Register)', items:[
    ['doc.page','Документы: просмотр','Dokumente: ansehen'],
    ['doc.edit','Документы: создавать, изменять, удалять','Dokumente: anlegen, ändern, löschen']
  ]},
  {id:'report', ru:'Отчёты', de:'Berichte', items:[
    ['report.work','Отчёт о проделанной работе за период','Bericht über geleistete Arbeit im Zeitraum'],
    ['report.perf','Leistung nach Mitarbeitern','Leistung nach Mitarbeitern'],
    ['report.ein','Einblasprotokolle','Einblasprotokolle'],
    ['report.prob','Незавершённые и проблемные акты','Unvollständige und problematische Akte'],
    ['report.chron','Хронология по адресу','Chronologie je Adresse'],
    ['report.auf','Aufmaß: не оформлено','Aufmaß: nicht erfasst'],
    ['report.pop','Pop Gestell/Kabel vorbereiten','Pop Gestell/Kabel vorbereiten'],
    ['report.muffe','Muffe','Muffe']
  ]},
  {id:'search', ru:'Поиск', de:'Suche', items:[
    ['search.page','Поиск по встречам и адресам','Suche in Terminen und Adressen'],
    ['search.full','Поиск полный (по всей программе)','Volle Suche (im ganzen Programm)']
  ]},
  {id:'settings', ru:'Настройки', de:'Einstellungen', items:[
    ['settings.page','Раздел «Настройки»','Bereich „Einstellungen“'],
    ['settings.users','Пользователи: создавать, менять пароли, блокировать','Benutzer: anlegen, Passwörter, sperren'],
    ['settings.roles','Роли и права доступа','Rollen und Zugriffsrechte'],
    ['settings.general','Общие настройки (Foto-gis и др.)','Allgemeine Einstellungen (Foto-gis u. a.)'],
    ['settings.backup','Резервные копии','Datensicherung'],
    ['settings.delete','Групповое удаление','Gruppenlöschung'],
    ['settings.audit','Журнал действий','Aktivitätsprotokoll']
  ]}
];
export const ALL_KEYS = PERM_GROUPS.flatMap(g=>g.items.map(x=>x[0]));
const ALL = new Set(ALL_KEYS);

// The roles the program starts with (a copy for the administrator to adjust; nothing here is fixed).
const REPORTS_ALL = ['report.work','report.perf','report.ein','report.prob','report.chron','report.auf','report.pop','report.muffe'];
const MONTEUR = ['dash.allTab','meet.createOwn','meet.edit','meet.reassign','meet.close','meet.deleteOwn','project.page','work.page','work.editOwn','report.prob','report.chron','report.pop','report.muffe','search.page','search.full'];
export const DEFAULT_ROLES = [
  {id:'role_assistenz', name:'Team Assistenz', perms:['dash.allTab','dash.teamBox','meet.page','meet.create','meet.createOwn','meet.edit','meet.reassign','meet.close','meet.delete','meet.deleteOwn','project.page','work.page','report.prob','report.chron','search.page']},
  {id:'role_monteur', name:'Монтёр', perms:MONTEUR},
  {id:'role_chef', name:'Шеф', perms:[...MONTEUR,'dash.teamBox','meet.page','meet.create','meet.delete','work.editAll','doc.page',...REPORTS_ALL]}
].map(r=>({id:r.id,name:r.name,perms:Object.fromEntries(r.perms.map(k=>[k,true]))}));

// Accounts made before roles existed.
const LEGACY = {
  editor: new Set(ALL_KEYS.filter(k=>!k.startsWith('settings.')||k==='settings.page')),
  viewer: new Set(ALL_KEYS.filter(k=>/\.page$/.test(k)||k==='search.full'||k==='dash.allTab'||k==='dash.teamBox'||k.startsWith('report.')))
};

export function permsOf(roleId, roles) {
  if (!roleId || roleId==='admin') return new Set(ALL);
  const role = (roles||[]).find(r=>r && r.id===roleId);
  if (role) return new Set(Object.keys(role.perms||{}).filter(k=>role.perms[k]===true && ALL.has(k)));
  if (LEGACY[roleId]) return new Set(LEGACY[roleId]);
  return new Set();
}
export const roleExists = (roleId, roles) => roleId==='admin' || LEGACY[roleId]!==undefined || (roles||[]).some(r=>r && r.id===roleId);
export const userLabel = u => (((u.firstName||'')+' '+(u.lastName||'')).trim()) || u.login || '';

const ADDRESS_FIELDS = ['homeId','apartments','tbmId','fotoGis','we'];
const TERMIN_IGNORED = ['updatedAt','takenFrom'];
const same = (a,b) => JSON.stringify(a)===JSON.stringify(b);

// What does a change of a meeting consist of: other executor / closing / the rest (time, address, quantities, ...).
export function terminChange(old, now) {
  const need = new Set();
  if (old.userId!==now.userId || old.userName!==now.userName) need.add('meet.reassign');
  const oi = old.items||[], ni = now.items||[];
  if (oi.length!==ni.length) need.add('meet.edit');
  else for (let i=0;i<oi.length;i++) {
    if (oi[i].workType!==ni[i].workType || oi[i].amount!==ni[i].amount) need.add('meet.edit');
    if (oi[i].done!==ni[i].done || oi[i].workId!==ni[i].workId) need.add('meet.close');
  }
  if (old.done!==now.done || old.doneAt!==now.doneAt) need.add('meet.close');
  const skip = new Set([...TERMIN_IGNORED,'userId','userName','items','done','doneAt']);
  for (const k of new Set([...Object.keys(old),...Object.keys(now)])) if (!skip.has(k) && !same(old[k],now[k])) need.add('meet.edit');
  return [...need];
}

// ctx = {userId, label, can(key)}; op = {collection,id,value|null}; old = the record as it is now (undefined when new).
// Returns null when the change is allowed, otherwise the reason in Russian.
export function checkOp(ctx, op, old) {
  const {collection:c, value:v} = op, creating = old===undefined || old===null, removing = v===null;
  const no = what => `Нет прав: ${what}.`;
  const can = k => ctx.can(k);
  switch (c) {
    case 'users':   return can('settings.users') ? null : no('пользователи');
    case 'roles':   return can('settings.roles') ? null : no('роли и права доступа');
    case 'projects':return can('project.edit') || can('dict.edit') ? null : no('изменение проекта');
    case 'pops': case 'schachts': case 'cables': case 'lbnummern': case 'leistungen': case 'splicePlans':
      return can('dict.edit') ? null : no('изменение справочников');
    case 'addresses': {
      if (can('dict.edit')) return null;
      if (!creating && !removing && (can('work.editOwn')||can('work.editAll')||can('meet.edit')||can('meet.close'))) {
        const keys = new Set([...Object.keys(old),...Object.keys(v)]);
        if ([...keys].every(k=>same(old[k],v[k]) || ADDRESS_FIELDS.includes(k))) return null;
      }
      return no('изменение адресов');
    }
    case 'aufmassRegisters': case 'aufmassDocuments': return can('doc.edit') ? null : no('изменение документов Aufmaß');
    case 'aufmassSettings': return can('doc.edit') || can('settings.general') ? null : no('настройки Aufmaß');
    case 'settings319': return can('settings.general') ? null : no('общие настройки');
    case 'addrHistory': return ['dict.edit','work.editOwn','work.editAll','meet.edit','meet.close','meet.create','meet.createOwn'].some(can) ? null : no('изменение данных');
    case 'works': {
      if (can('work.editAll')) return null;
      if (can('work.editOwn')) {
        const mine = r => r && r.performer===ctx.label;
        if (creating) return mine(v) ? null : no('акты можно создавать только на себя');
        if (removing) return mine(old) ? null : no('можно удалять только свои акты');
        return mine(old) && mine(v) ? null : no('можно изменять только свои акты');
      }
      return no('изменение актов');
    }
    case 'termine': {
      if (creating) {
        if (can('meet.create')) return null;
        return can('meet.createOwn') && v && v.userId===ctx.userId ? null : no('создание встреч (только на себя)');
      }
      if (removing) {
        if (can('meet.delete')) return null;
        return can('meet.deleteOwn') && old.userId===ctx.userId ? null : no('удаление встреч (только своих)');
      }
      const need = terminChange(old, v);
      const labels = {'meet.reassign':'смена исполнителя','meet.close':'закрытие встречи','meet.edit':'редактирование встречи'};
      const miss = need.find(k=>!can(k));
      return miss ? no(labels[miss]) : null;
    }
    default: return null;
  }
}
export function makeCtx(user, roles) {
  const set = permsOf(user && user.role, roles);
  return {userId:user && user.id, label:user ? userLabel(user) : '', can:k=>set.has(k), set};
}
