/** RFC 4180 fields, including quoted commas/newlines and escaped quotes. */
export function parseCsv(text:string):string[][]{
 const rows:string[][]=[];let row:string[]=[],field='',quoted=false,closed=false;
 text=text.replace(/^\uFEFF/,'');
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(quoted){if(c==='"'){if(text[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=c;continue;}
  if(c==='"'){if(field||closed)throw Error('CSVの引用符の形式を確認してください。');quoted=true;}
  else if(c===','){row.push(field);field='';closed=false;}
  else if(c==='\r'||c==='\n'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);if(row.some(v=>v.length))rows.push(row);row=[];field='';closed=false;}
  else{if(closed)throw Error('CSVの引用符の後に不正な文字があります。');field+=c;}
 }
 if(quoted)throw Error('CSVの引用符が閉じていません。');
 row.push(field);if(row.some(v=>v.length))rows.push(row);
 return rows;
}
export async function readContactCsv(file:File){
 if(file.size>10*1024*1024)throw Error('CSVは10MiB以内に分割してください。');
 const bytes=await file.arrayBuffer();let text:string;
 try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{text=new TextDecoder('shift-jis',{fatal:true}).decode(bytes);}
 const [headers,...rows]=parseCsv(text);
 if(!headers?.length||new Set(headers).size!==headers.length)throw Error('CSVの見出しが空か重複しています。');
 if(rows.length>20000)throw Error('1ファイルは20,000件以内にしてください。');
 if(rows.some(r=>r.length!==headers.length))throw Error('CSVの列数が一致しない行があります。');
 return {headers,rows};
}
export function contactRows(csv:{headers:string[];rows:string[][]},emailColumn:string,nameColumn:string,status:string,tag:string,consent:string){
 const ei=csv.headers.indexOf(emailColumn),ni=csv.headers.indexOf(nameColumn);
 if(ei<0)throw Error('メールアドレスの列を選択してください。');
 if(status==='active'&&!consent.trim())throw Error('配信同意の根拠を入力してください。');
 return csv.rows.map((r,i)=>{
  const email=r[ei].trim().toLowerCase();
  if(!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)||email.length>254)throw Error(`${i+2}行目のメールアドレスを確認してください。取り込みは開始していません。`);
  return {email,name:ni>=0?r[ni]:'',status,tags:tag.trim()?[tag.trim()]:[],fields:Object.fromEntries(csv.headers.map((h,j)=>[h,r[j]]).filter(([,v])=>v!=='')),consent_note:consent.trim()};
 });
}
export type ContactArchive={source:string;contacts:{email:string;name:string;status:string;tags:string[];fields:Record<string,unknown>;consent_note:string}[];lists:{name:string;tags:string[]}[]};
export function readContactArchive(text:string):ContactArchive{
 const data=JSON.parse(text);
 if(!Array.isArray(data.contacts)||data.contacts.length>20000||!Array.isArray(data.lists)||data.lists.length>1000)throw Error('コンタクト移行ファイルの形式を確認してください。');
 for(const c of data.contacts){
  if(typeof c.email!=='string'||!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(c.email)||c.email.length>254||!['active','unconfirmed','unsubscribed','bounced','complained'].includes(c.status)||!Array.isArray(c.tags)||c.tags.length>100||c.tags.some((t:unknown)=>typeof t!=='string')||!c.fields||typeof c.fields!=='object'||Array.isArray(c.fields))throw Error('メールアドレス・状態・タグ・カスタム項目を確認してください。');
  if(c.status==='active'&&(typeof c.consent_note!=='string'||!c.consent_note.trim()))throw Error('配信同意の記録がないコンタクトがあります。');
 }
 for(const l of data.lists)if(typeof l.name!=='string'||!l.name.trim()||!Array.isArray(l.tags)||l.tags.length>100||l.tags.some((t:unknown)=>typeof t!=='string'))throw Error('リスト情報を確認してください。');
 return data;
}
