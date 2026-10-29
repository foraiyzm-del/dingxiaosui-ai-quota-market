import {redirect} from 'next/navigation';
import {eventActivationEnabled} from '@/lib/event-credits';
import PlatformShell from '../platform-shell';
import {platform} from '@/lib/tenancy';
import CodesClient from './codes-client';
export const dynamic='force-dynamic';
export default async function Page(){if(eventActivationEnabled())redirect('/platform/event-codes');let allowed=false;try{await platform();allowed=true;}catch{}return <PlatformShell active="codes"><div className="platform-heading"><div><div className="tenant-label">ACTIVATION CODES</div><h1>把创作点，交到客户手里。</h1><p>售卖、赠送、兑换与使用，每一步都有记录。</p></div></div>{allowed?<CodesClient/>:<section><h2>请使用平台管理员账号登录</h2><p>激活码的生成和作废只对平台管理员开放。</p><a href="/login?return_to=/platform/activation-codes">登录平台管理员账号 ↗</a></section>}</PlatformShell>;}
