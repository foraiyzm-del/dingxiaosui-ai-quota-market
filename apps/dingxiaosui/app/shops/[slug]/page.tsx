import { publicShop } from "@/lib/public-shop";
import "../../tenancy.css";
export const dynamic="force-dynamic";
export default async function ShopPage({params}:{params:Promise<{slug:string}>}){
 let shop;try{shop=await publicShop((await params).slug)}catch{return <main className="tenant-shell"><h1>店铺暂时无法读取</h1><p>请稍后重试，未使用演示资料替代。</p></main>}
 if(!shop)return <main className="tenant-shell"><a href="/">✿ 紫丁香计划</a><h1>店铺不存在或已停用</h1></main>;
 return <main className="tenant-shell"><a href="/">✿ 紫丁香计划</a><p className="tenant-label">MERCHANT STOREFRONT</p><section className="tenant-panel"><h1>{shop.name}</h1><p className="tenant-public">{shop.description||"商家尚未填写公开介绍。"}</p>{shop.publicContact&&<p>公开联系方式：{shop.publicContact}</p>}</section><p>当前提供商户公开资料展示。商品、咨询与交易功能尚未接入此店铺。</p></main>;
}
