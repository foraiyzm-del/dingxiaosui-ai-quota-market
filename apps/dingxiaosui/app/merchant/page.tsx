import TenantShell from "../tenant-shell";
import MerchantClient from "./merchant-client";
export const dynamic="force-dynamic";
export default function MerchantPage(){return <TenantShell><div className="tenant-label">MERCHANT WORKSPACE</div><h1>我的商户与店铺</h1><p>负责人可维护店铺公开资料；普通成员只能查看所属商户的资料。</p><MerchantClient/></TenantShell>}
