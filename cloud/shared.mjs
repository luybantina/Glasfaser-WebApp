export const LISTS = ['projects','pops','schachts','addresses','cables','works','lbnummern','leistungen','aufmassRegisters','aufmassDocuments','users','termine'];
export const OBJECTS = ['aufmassSettings','settings319','addrHistory'];
export const COLLECTIONS = [...LISTS,...OBJECTS];
export const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
export const clone = x => x === undefined ? undefined : JSON.parse(JSON.stringify(x));
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const safeKey = x => !['__proto__','constructor','prototype'].includes(x);

// A three-way merge preserves independent edits, additions and deletions. The
// same field edited differently is a conflict, including delete-versus-edit.
export function merge(base, local, remote, path = '', conflicts = [], choose = {}) {
  if (equal(local,base)) return clone(remote);
  if (equal(remote,base) || equal(local,remote)) return clone(local);
  if (object(base) && object(local) && object(remote)) {
    const result = {};
    for (const key of new Set([...Object.keys(base),...Object.keys(local),...Object.keys(remote)])) {
      if (!safeKey(key)) throw new Error('Invalid data key');
      const value = merge(base[key],local[key],remote[key],`${path}/${key}`,conflicts,choose);
      if (value !== undefined) result[key] = value;
    }
    return result;
  }
  if ([base,local,remote].every(Array.isArray) && [base,local,remote].every(a=>a.every(x=>object(x)&&typeof x.id==='string'))) {
    const [b,l,r] = [base,local,remote].map(a=>new Map(a.map(x=>[x.id,x])));
    const result = [];
    for (const id of new Set([...r.keys(),...l.keys(),...b.keys()])) {
      const value=merge(b.get(id),l.get(id),r.get(id),`${path}/${id}`,conflicts,choose);
      if(value!==undefined)result.push(value);
    }
    return result;
  }
  if (choose[path]) return clone(choose[path]==='remote'?remote:local);
  conflicts.push({path,base,local,remote});
  return clone(local);
}

export function records(data) {
  const result = new Map();
  for(const collection of COLLECTIONS) {
    if(LISTS.includes(collection)) {
      for(const row of data[collection]||[]) {
        if(!row || typeof row.id!=='string' || result.has(`${collection}/${row.id}`))throw new Error(`Invalid or duplicate ID: ${collection}`);
        result.set(`${collection}/${row.id}`,{collection,id:row.id,value:row});
      }
    } else if(data[collection]!==undefined)result.set(`${collection}/root`,{collection,id:'root',value:data[collection]});
  }
  return result;
}
export function diff(base, data) {
  const b=records(base),d=records(data),result=[];
  for(const key of new Set([...b.keys(),...d.keys()])) {
    if(!equal(b.get(key)?.value,d.get(key)?.value)) {
      const row=d.get(key)||b.get(key);
      result.push({collection:row.collection,id:row.id,value:d.has(key)?row.value:null});
    }
  }
  return result;
}
export function apply(data,operations) {
  const r=records(data);
  for(const op of operations) {
    const key=`${op.collection}/${op.id}`;
    if(op.value===null)r.delete(key);else r.set(key,clone(op));
  }
  return unpack([...r.values()].map(x=>({collection:x.collection,id:x.id,payload:JSON.stringify(x.value)})));
}
export function unpack(rows) {
  const result=Object.fromEntries(LISTS.map(k=>[k,[]]));
  for(const row of rows) {
    if(!COLLECTIONS.includes(row.collection))throw new Error('Unknown collection');
    if(LISTS.includes(row.collection))result[row.collection].push(JSON.parse(row.payload));
    else result[row.collection]=JSON.parse(row.payload);
  }
  return result;
}
