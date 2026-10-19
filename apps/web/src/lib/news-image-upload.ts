export type ImageUploadProgress={percent:number;processing:boolean};
export function uploadNewsImage(file:File,facilityId:string,onProgress:(progress:ImageUploadProgress)=>void):Promise<string>{
 return new Promise((resolve,reject)=>{
  const request=new XMLHttpRequest();request.open('POST','/admin/news/images');request.timeout=60000;
  request.upload.onprogress=event=>{if(event.lengthComputable)onProgress({percent:Math.round(event.loaded/event.total*100),processing:false});};
  request.upload.onload=()=>onProgress({percent:100,processing:true});
  request.onerror=()=>reject(Error('通信できませんでした。もう一度画像を追加してください。'));
  request.ontimeout=()=>reject(Error('画像のアップロードがタイムアウトしました。もう一度お試しください。'));
  request.onabort=()=>reject(Error('画像のアップロードを中止しました。'));
  request.onload=()=>{try{const result=JSON.parse(request.responseText);if(request.status<200||request.status>=300||typeof result.url!=='string')throw Error(result.error||'画像を追加できませんでした。');resolve(result.url);}catch(error){reject(error instanceof Error?error:Error('画像を追加できませんでした。'));}};
  const data=new FormData();data.set('file',file);data.set('facilityId',facilityId);onProgress({percent:0,processing:false});request.send(data);
 });
}
