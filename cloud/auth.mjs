import {createHash, timingSafeEqual} from 'node:crypto';
export const digest = x => createHash('sha256').update(x).digest('hex');
export function legacyHash(password,salt) {
  let value=`${salt}:${password}`;
  for(let i=0;i<1000;i++)value=digest(`${salt}:${value}`);
  return value;
}
export function checkPassword(password,user) {
  if(!user||user.blocked||typeof user.salt!=='string'||!/^\w{64}$/.test(user.passHash||''))return false;
  return timingSafeEqual(Buffer.from(legacyHash(password,user.salt)),Buffer.from(user.passHash));
}
export function publicUser(user) {
  const {salt,passHash,...safe}=user;
  return {...safe,hasPassword:!!(user.salt&&user.passHash)};
}
