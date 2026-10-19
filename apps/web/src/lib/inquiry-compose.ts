export const INQUIRY_ATTACHMENT_LIMIT = 5 * 1024 * 1024;
export const INQUIRY_ATTACHMENT_COUNT = 10;
export type InquiryAttachment = {id:string;inquiry_id:string;message_id:string|null;filename:string;mime_type:string;size_bytes:number;created_at:string};
export type InquirySignature = {template:string;version:number};
const mimeByExtension:Record<string,string>={pdf:'application/pdf',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',gif:'image/gif',webp:'image/webp',avif:'image/avif',bmp:'image/bmp',tif:'image/tiff',tiff:'image/tiff',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',xlsm:'application/vnd.ms-excel.sheet.macroenabled.12',xls:'application/vnd.ms-excel',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',doc:'application/msword',csv:'text/csv'};
export function inquiryAttachmentMime(name:string):string|null{return mimeByExtension[name.split('.').at(-1)?.toLowerCase()??'']??null;}
export const attachmentSize=(size:number)=>size<1024*1024?Math.ceil(size/1024)+' KB':(size/1024/1024).toFixed(1)+' MB';
export function renderInquirySignature(template:string,name:string):string{return name.trim()?template.replaceAll('{担当者名}',name.trim()).trim():'';}
export function replyWithoutSignature(text:string,signature:string):string{return signature&&text.endsWith(signature)?text.slice(0,-signature.length).trimEnd():text;}
export function replyWithSignature(body:string,signature:string):string{return signature?body.trimEnd()+(body.trimEnd()?'\n\n':'')+signature:body;}
