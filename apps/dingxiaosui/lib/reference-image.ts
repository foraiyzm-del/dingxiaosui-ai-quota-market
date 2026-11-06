export type ReferenceImage={dataUrl:string;hash:string;name:string;width:number;height:number};
const maxReferenceBytes=6*1024*1024;
const maxUploadEdge=4096;

export async function prepareReference(file:File):Promise<ReferenceImage>{
 if(!file.size||file.size>maxReferenceBytes)throw Error('图片须小于等于 6 MB，请压缩后重新选择。');
 // Some file pickers omit MIME types. Decode the supported bytes, not the filename.
 const head=new Uint8Array(await file.slice(0,16).arrayBuffer()),ascii=(start:number,end:number)=>new TextDecoder().decode(head.slice(start,end));
 const mime=head.length>=8&&[137,80,78,71,13,10,26,10].every((v,i)=>head[i]===v)?'image/png':head.length>=3&&head[0]===255&&head[1]===216&&head[2]===255?'image/jpeg':head.length>=16&&ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP'&&['VP8 ','VP8L','VP8X'].includes(ascii(12,16))?'image/webp':null;
 if(!mime)throw Error('请选择有效的 JPG、PNG 或 WebP 图片；HEIC 等格式请先转换。');
 const url=URL.createObjectURL(new Blob([file],{type:mime})),image=new window.Image();
 let canvas:HTMLCanvasElement|null=null;
 try{
  await new Promise<void>((resolve,reject)=>{image.onload=()=>resolve();image.onerror=()=>reject(Error('这张图片无法读取，请重新导出为 JPG、PNG 或 WebP。'));image.src=url});
  const sourceWidth=image.naturalWidth,sourceHeight=image.naturalHeight;
  if(!sourceWidth||!sourceHeight||sourceWidth>8192||sourceHeight>8192||sourceWidth*sourceHeight>40000000)throw Error('图片尺寸过大，请缩小至最长边 8192 像素、总像素 4000 万以内后再试。');
  // Match the quota center's image limits without cropping, stretching or upscaling.
  const scale=Math.min(1,maxUploadEdge/Math.max(sourceWidth,sourceHeight));
  const width=Math.max(1,Math.round(sourceWidth*scale)),height=Math.max(1,Math.round(sourceHeight*scale));
  // Re-encode pixels to remove EXIF/location metadata; retain transparency in PNG/WebP.
  canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const context=canvas.getContext('2d');if(!context)throw Error('浏览器暂时无法处理图片，请换一个浏览器重试。');
  context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';
  context.drawImage(image,0,0,width,height);
  const blob=await new Promise<Blob>((resolve,reject)=>canvas!.toBlob(value=>value?resolve(value):reject(Error('图片处理失败，请重新选择。')),mime,0.94));
  if(blob.size>maxReferenceBytes)throw Error('处理后的图片超过 6 MB，请缩小图片后重试。');
  const bytes=await blob.arrayBuffer(),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('');
  const dataUrl=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(Error('图片读取失败，请重新选择。'));reader.readAsDataURL(blob)});
  return {dataUrl,hash,name:file.name,width,height};
 }finally{if(canvas){canvas.width=0;canvas.height=0}URL.revokeObjectURL(url);image.onload=null;image.onerror=null}
}
