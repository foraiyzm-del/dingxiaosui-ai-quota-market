'use client';
import {useState} from 'react';
export default function Logout(){const [error,setError]=useState('');return <main style={{padding:60}}><h1>退出登录</h1><button onClick={async()=>{try{const r=await fetch('/api/auth',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'logout'})});if(!r.ok)throw Error();try{localStorage.setItem('zdx-auth-change-v1',String(Date.now())+':'+crypto.randomUUID())}catch{}location.replace('/login')}catch{setError('退出失败，请重试')}}}>确认退出</button><p>{error}</p><a href="/">返回首页</a></main>}
