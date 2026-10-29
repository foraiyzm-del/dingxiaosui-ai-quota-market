import {centerRequired,verifiedZlgIdentity} from './zlg-gateway';
import { env } from "cloudflare:workers";
import {passwordAuthEnabled,passwordIdentity} from './password-auth';
import {eventIdentity,eventSessionEnabled} from './event-session';

declare const __ZDX_LOCAL_AUTH__: boolean;
export type Identity = { userId: string; email: string; displayName: string; fullName: string | null; provider: "local-test" | "sites" | "password" | "zlg" | "event" | "quota_center"; platformAdmin?:boolean };
type Vars = { APP_ENV?: string; LOCAL_AUTH_ENABLED?: string; LOCAL_AUTH_SECRET?: string; PLATFORM_ADMIN_SUBJECTS?: string };
const vars = () => env as unknown as Vars;
export const localIdentities: Record<string, Identity> = {
  platform: {provider:"local-test",userId:"test-platform",email:"platform@local.test",displayName:"测试平台管理员",fullName:null},
  ownerA: {provider:"local-test",userId:"test-owner-a",email:"owner-a@local.test",displayName:"测试商户 A 负责人",fullName:null},
  memberA: {provider:"local-test",userId:"test-member-a",email:"member-a@local.test",displayName:"测试商户 A 普通成员",fullName:null},
  ownerB: {provider:"local-test",userId:"test-owner-b",email:"owner-b@local.test",displayName:"测试商户 B 负责人",fullName:null},
};
export function localAuthEnabled() {
  return typeof __ZDX_LOCAL_AUTH__ !== 'undefined' && __ZDX_LOCAL_AUTH__ && vars().APP_ENV === "local" && vars().LOCAL_AUTH_ENABLED === "1" && (vars().LOCAL_AUTH_SECRET?.length || 0) >= 32;
}
// Sites supplies identity via its dispatch gateway. The current checkout has no
// independently verifiable gateway signature or proven origin isolation. Fail
// closed until that production trust boundary is verified; never accept raw heads.
export function identityReady() { return centerRequired() || localAuthEnabled() || passwordAuthEnabled() || eventSessionEnabled(); }
export function platformIdentity(identity: Identity) {
  if(identity.provider==='event'||identity.provider==='quota_center')return false;
  if(identity.provider==='password')return identity.platformAdmin===true;
  return String(vars().PLATFORM_ADMIN_SUBJECTS || "").split(",").map(x=>x.trim()).includes(`${identity.provider}:${identity.userId}`);
}
export function loopbackHost(host: string | null) {
  return !!host && /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host);
}
const cookieName = "zdx_local_test_session";
async function hmac(text: string) {
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(vars().LOCAL_AUTH_SECRET!),{name:"HMAC",hash:"SHA-256"},false,["sign","verify"]);
  return {key,bytes:new TextEncoder().encode(text)};
}
function encode(bytes: Uint8Array) { return btoa(String.fromCharCode(...bytes)).replaceAll("+","-").replaceAll("/","_").replace(/=+$/,""); }
function decode(text:string) { return Uint8Array.from(atob(text.replaceAll("-","+").replaceAll("_","/")),c=>c.charCodeAt(0)); }
export async function localCookie(alias: string) {
  if(!localAuthEnabled() || !Object.hasOwn(localIdentities,alias)) throw new Error("Local authentication disabled");
  const value=encode(new TextEncoder().encode(JSON.stringify({alias,exp:Date.now()+4*3600_000,aud:"zdx-local-only"})));
  const {key,bytes}=await hmac(value);
  return `${cookieName}=${value}.${encode(new Uint8Array(await crypto.subtle.sign("HMAC",key,bytes)))}; HttpOnly; SameSite=Strict; Path=/; Max-Age=14400`;
}
export function clearLocalCookie(){return `${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;}
export async function resolveIdentity(headers: Headers): Promise<Identity | null> {
  if(centerRequired()){ const who=await verifiedZlgIdentity(headers); if(who)return {provider:"zlg",userId:who.sub,email:"",displayName:who.name,fullName:null,platformAdmin:false}; return null; }
  if(passwordAuthEnabled()){const password=await passwordIdentity(headers);if(password)return password;}
  if(eventSessionEnabled())return eventIdentity(headers);
  if(passwordAuthEnabled())return null;
  if(!localAuthEnabled() || !loopbackHost(headers.get("host"))) return null;
  // Ignore oai-authenticated-*, x-user-id and any caller-supplied role/tenant data.
  const matches=(headers.get("cookie")||"").split(";").map(x=>x.trim()).filter(x=>x.startsWith(cookieName+"="));
  if(matches.length!==1)return null;
  try{
    const [value,signature,extra]=matches[0].slice(cookieName.length+1).split(".");
    if(extra || !value || !signature || value.length>500)return null;
    const {key,bytes}=await hmac(value);
    if(!await crypto.subtle.verify("HMAC",key,decode(signature),bytes))return null;
    const payload=JSON.parse(new TextDecoder().decode(decode(value)));
    if(payload.aud!=="zdx-local-only" || !Number.isFinite(payload.exp) || payload.exp<Date.now() || !Object.hasOwn(localIdentities,payload.alias))return null;
    return localIdentities[payload.alias];
  }catch{return null;}
}
