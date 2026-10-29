import {api,json,actor,input} from '@/lib/tenancy';
import {paymentCapabilities,createOrder,ownOrders} from '@/lib/payments';
export const dynamic='force-dynamic';
export function GET(r:Request){return api(r,async()=>{const u=await actor();return json({...paymentCapabilities(),orders:await ownOrders(u.id)})})}
export function POST(r:Request){return api(r,async()=>{const u=await actor();return json(await createOrder(u.id,await input(r,['productId','channel','idempotencyKey'])))})}
