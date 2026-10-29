import { db } from "./tenancy";
export async function publicShop(slug:string){
 if(!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(slug))return null;
 return db().prepare("SELECT s.slug,s.name,s.description,s.public_contact AS publicContact FROM merchant_shops s JOIN merchants m ON m.id=s.merchant_id WHERE s.slug=? AND m.status='active'").bind(slug).first<{slug:string;name:string;description:string;publicContact:string}>();
}
