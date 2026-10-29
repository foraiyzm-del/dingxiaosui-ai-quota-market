export type FilmSegment={prompt:string;narration:string};
export type FilmJob={id:string;title:string;status:string;stage:string;error:string|null;createdAt:string;updatedAt:string;canResume:boolean;segments:{status:string;stage:string}[];output?:{videoUrl:string;downloadUrl:string;subtitleUrl:string;duration:number;width:number;height:number;subtitleTiming:string}};
export type FilmSettings={revision:number;videoModel:string;hasVideoKey:boolean;hasSpeechKey:boolean;speechAuthMode:'apiKey'|'legacy';speechAppId:string;hasSpeechAccessToken:boolean;speechResourceId:string;speechVoice:string};
export type FilmCapabilities={ready:boolean;missing:string[];video:{configured:boolean;model:string};speech:{configured:boolean;voiceName:string};renderer:{ready:boolean;reason?:string}};
export type FilmAsset={path:string;contentType:string;filename:string};
export class FilmError extends Error {status:number;constructor(status:number,message:string);}
export function createFilmStudio(options:{directory:string;providers?:Record<string,unknown>;renderer?:unknown;rendererCheck?:unknown;pollMs?:number;maxPolls?:number}):{
 capabilities():Promise<FilmCapabilities>;
 publicSettings():FilmSettings;
 saveSettings(body:Record<string,unknown>):FilmSettings;
 create(owner:string,body:Record<string,unknown>):Promise<FilmJob>;
 resume(owner:string,id:string,body:Record<string,unknown>):Promise<FilmJob>;
 asset(owner:string,id:string,type:string):FilmAsset;
 list(owner:string):FilmJob[];
 get(owner:string,id:string):FilmJob;
 workspace(owner:string,canConfigure?:boolean):Promise<{preset:{title:string;segments:FilmSegment[]};capabilities:FilmCapabilities;storageScope:string;canConfigure:boolean;jobs:FilmJob[]}>;
 wait():Promise<void>;
};
export function filmAssetResponse(asset:FilmAsset,request:Request):Response;
