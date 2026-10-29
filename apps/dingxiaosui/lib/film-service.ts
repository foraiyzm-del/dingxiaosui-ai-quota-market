import path from 'node:path';
import {createFilmStudio,filmAssetResponse,FilmError} from '@/runtime/film-studio.mjs';
import {actor,platform as requirePlatform,strictOrigin,ApiError,json} from './tenancy';
import {platformMediaAllowed} from './media-config';

const singleton=globalThis as typeof globalThis & {__zdxFilmStudio?:ReturnType<typeof createFilmStudio>};
function studio(){
 if(!singleton.__zdxFilmStudio)singleton.__zdxFilmStudio=createFilmStudio({directory:path.join(process.env.ZDX_DATA_DIR||path.resolve('.local-runtime/data'),'video-studio')});
 return singleton.__zdxFilmStudio;
}
async function body(request:Request){const value=await request.text();if(value.length>24000)throw new ApiError(413,'短片资料过长');try{const parsed=JSON.parse(value);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error();return parsed;}catch{throw new ApiError(400,'提交格式不正确');}}
export async function handleFilmRequest(request:Request,parts:string[]){
 try{
  const user=await actor();if(!await platformMediaAllowed(user,'video'))throw new ApiError(403,'当前体验卡不包含视频创作，或账号尚未开通视频权限');
  if(!['GET','HEAD'].includes(request.method))strictOrigin(request);
  const engine=studio(),route=parts.join('/');
  if(route==='settings'){
   if(request.method==='GET')return json({settings:engine.publicSettings(),canConfigure:user.platformAdmin});
   if(request.method==='PUT'){await requirePlatform();return json({settings:engine.saveSettings(await body(request)),canConfigure:true});}
  }
  if(!route){
   if(request.method==='GET')return json(await engine.workspace(user.id,user.platformAdmin));
   if(request.method==='POST')return json({job:await engine.create(user.id,await body(request))},202);
  }
  if(parts[0]==='jobs'&&parts[1]){
   if(parts.length===2&&request.method==='GET')return json({job:engine.get(user.id,parts[1])});
   if(parts[2]==='resume'&&parts.length===3&&request.method==='POST')return json({job:await engine.resume(user.id,parts[1],await body(request))},202);
   if(['video','subtitles'].includes(parts[2])&&parts.length===3&&['GET','HEAD'].includes(request.method))return filmAssetResponse(engine.asset(user.id,parts[1],parts[2]),request);
  }
  throw new ApiError(404,'未找到此短片操作');
 }catch(error){if(error instanceof FilmError)throw new ApiError(error.status,error.message);throw error;}
}
