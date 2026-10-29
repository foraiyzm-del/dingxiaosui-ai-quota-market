import {api} from '@/lib/tenancy';
import {handleFilmRequest} from '@/lib/film-service';
export const runtime='nodejs';
export const dynamic='force-dynamic';
type Context={params:Promise<{parts?:string[]}>};
async function handler(request:Request,context:Context){return api(request,async()=>handleFilmRequest(request,(await context.params).parts||[]));}
export const GET=handler;
export const HEAD=handler;
export const POST=handler;
export const PUT=handler;
