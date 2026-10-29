import {ApiError,db,field} from './tenancy';
export type Product={id:string;title:string;amountMinor:number;currency:'CNY'};
export type PaidEvent={eventId:string;orderId:string;transactionId:string;amountMinor:number;currency:string};
export type PaymentAdapter={
 // Implement against the provider's official SDK. Verify signature, timestamp,
 // merchant/app ID and successful trade state BEFORE returning a PaidEvent.
 verifyPaidWebhook:(rawBody:string,headers:Headers)=>Promise<PaidEvent>;
 // Provider request must use order.id as its idempotent merchant order number.
 createCheckout:(order:Order)=>Promise<{url:string}>;
 webhookSuccess:()=>Response;
};
export type Order={id:string;user_id:string;product_id:string;amount_minor:number;currency:string;channel:string;status:string;idempotency_key:string;provider_transaction_id:string|null};
// Deliberately empty until a real channel, server-side price and fulfillment are configured.
export const paymentProducts:Product[]=[];
export const paymentAdapters:Record<string,PaymentAdapter>=Object.create(null);
export function paymentCapabilities(){return {enabled:Object.keys(paymentAdapters).length>0&&paymentProducts.length>0,channels:Object.keys(paymentAdapters),products:paymentProducts,message:'支付尚未开通；接入支付服务并配置商品后启用'};}
export async function createOrder(userId:string,body:Record<string,unknown>){
 const channel=field(body.channel,40,true),productId=field(body.productId,80,true),key=field(body.idempotencyKey,100,true);
 const adapter=paymentAdapters[channel];if(!adapter)throw new ApiError(503,'支付渠道尚未开通');
 const product=paymentProducts.find(p=>p.id===productId);if(!product||!Number.isSafeInteger(product.amountMinor)||product.amountMinor<=0)throw new ApiError(400,'商品未上架');
 await db().prepare("INSERT INTO payment_orders(id,user_id,product_id,amount_minor,currency,channel,idempotency_key,created_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(user_id,idempotency_key) DO NOTHING").bind(crypto.randomUUID(),userId,product.id,product.amountMinor,product.currency,channel,key,new Date().toISOString()).run();
 const order=(await db().prepare('SELECT * FROM payment_orders WHERE user_id=? AND idempotency_key=?').bind(userId,key).first<Order>())!;
 if(order.product_id!==productId||order.channel!==channel)throw new ApiError(409,'重复请求标识已用于其他订单');
 if(order.status!=='pending')return {orderId:order.id,status:order.status};
 const checkout=await adapter.createCheckout(order);const url=new URL(checkout.url);if(url.protocol!=='https:')throw new ApiError(502,'支付服务未返回有效链接');
 return {orderId:order.id,status:order.status,checkoutUrl:url.href};
}
export async function ownOrders(userId:string){return (await db().prepare('SELECT id,product_id AS productId,amount_minor AS amountMinor,currency,channel,status,created_at AS createdAt,paid_at AS paidAt FROM payment_orders WHERE user_id=? ORDER BY created_at DESC LIMIT 100').bind(userId).all()).results;}
export async function recordPaid(channel:string,event:PaidEvent){
 const order=await db().prepare('SELECT * FROM payment_orders WHERE id=? AND channel=?').bind(event.orderId,channel).first<Order>();
 if(!order||event.currency!==order.currency||event.amountMinor!==order.amount_minor||!event.eventId||!event.transactionId)throw new ApiError(400,'支付通知与订单不匹配');
 if(order.status==='closed'||(order.provider_transaction_id&&order.provider_transaction_id!==event.transactionId))throw new ApiError(409,'订单状态冲突');
 const old=await db().prepare('SELECT order_id FROM payment_events WHERE channel=? AND event_id=?').bind(channel,event.eventId).first<{order_id:string}>();if(old){if(old.order_id!==order.id)throw new ApiError(409,'通知标识冲突');return;}
 const now=new Date().toISOString();
 await db().batch([
 db().prepare("UPDATE payment_orders SET status='paid',provider_transaction_id=?,paid_at=? WHERE id=? AND status='pending'").bind(event.transactionId,now,order.id),
 // A NOT NULL scalar subquery makes a concurrently conflicting transaction
 // roll back the entire batch rather than acknowledge an unpaid event.
 db().prepare("INSERT INTO payment_events(channel,event_id,order_id,received_at) VALUES (?,?,(SELECT id FROM payment_orders WHERE id=? AND status='paid' AND provider_transaction_id=?),?)").bind(channel,event.eventId,order.id,event.transactionId,now),
 ]);
}
