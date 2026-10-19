export type MailPart = { kind: 'body' | 'quote' | 'signature'; text: string };

const quotedLine = (line: string) => /^\s*[>＞]/.test(line);
const historyStart = (line: string, following: string[]) =>
 /^\s*(?:On .{5,}wrote:|.{4,}(?:さん|様)?(?:は書きました|のメッセージ)[:：]|-{2,}\s*(?:Original Message|Forwarded message|元のメッセージ)|Begin forwarded message:|転送されたメッセージ[:：])/i.test(line) ||
 (/^\s*\d{4}(?:年|[/-])\d{1,2}(?:月|[/-])\d{1,2}.{0,100}[:：]\s*$/.test(line) && (line.includes('@') || following.slice(0,3).some(quotedLine))) ||
 (/^\s*(?:From|差出人)\s*[:：]/i.test(line) && following.slice(0, 7).some(l => /^\s*(?:Sent|Date|送信日時|日時)\s*[:：]/i.test(l)) && following.slice(0, 9).some(l => /^\s*(?:To|Subject|宛先|件名)\s*[:：]/i.test(l)));
const decoration = (line: string) => /^[\s─━―—ー\-=_＊*◆◇■□●○・※+＋～~<>＜＞\\/|]{5,}$/.test(line);
const contact = (line: string) => /(?:[\w.+-]+@[\w.-]+\.[a-z]{2,}|https?:\/\/|www\.|(?:TEL|FAX|電話|携帯|〒)\s*[:：\d０-９]?|\d{2,4}[-－]\d{2,4}[-－]\d{3,4})/i.test(line);

function signatureAt(lines: string[]): number {
 for (let i = 0; i < lines.length; i++) {
  if (/^-- $/.test(lines[i])) return i;
  const tail = lines.slice(i);
  if (/^\s*(?:Sent from my (?:iPhone|iPad|Android)|iPhoneから送信|iPadから送信|Androidから送信)/i.test(lines[i]) && tail.filter(l => l.trim()).length <= 3) return i;
  // Decorative separators are only treated as signatures with contact details below.
  if (decoration(lines[i]) && tail.length <= 24 && tail.some(contact)) return i;
  // A short trailing contact block needs two independent contact lines and a blank boundary.
  if (i > 0 && !lines[i - 1].trim() && lines[i].trim() && tail.length <= 16 && tail.filter(contact).length >= 2 && tail.every(l => l.length <= 100)) {
   const firstContact = tail.findIndex(contact);
   if (firstContact >= 0 && firstContact <= 3) return i;
  }
 }
 return -1;
}

/** Display only: the stored email and AI reference text are never changed. */
export function splitInquiryMail(raw: string): MailPart[] {
 const lines = raw.replace(/\r\n?/g, '\n').split('\n');
 const parts: MailPart[] = [];
 let pending: string[] = [];
 const flush = (kind: MailPart['kind']) => {
  const text = pending.join('\n').trim();
  if (text) parts.push({ kind, text });
  pending = [];
 };
 for (let i = 0; i < lines.length; i++) {
  if (historyStart(lines[i], lines.slice(i + 1))) {
   flush('body'); pending = lines.slice(i); flush('quote'); break;
  }
  if (quotedLine(lines[i])) {
   flush('body'); pending.push(lines[i]);
   while (i + 1 < lines.length && (quotedLine(lines[i + 1]) || !lines[i + 1].trim())) pending.push(lines[++i]);
   flush('quote');
  } else pending.push(lines[i]);
 }
 flush('body');
 const result: MailPart[] = [];
 for (const part of parts) {
  if (part.kind !== 'body') { result.push(part); continue; }
  const ownLines = part.text.split('\n');
  const start = signatureAt(ownLines);
  if (start < 0) { result.push(part); continue; }
  const body = ownLines.slice(0, start).join('\n').trim();
  if (body) result.push({ kind: 'body', text: body });
  result.push({ kind: 'signature', text: ownLines.slice(start).join('\n').trim() });
 }
 return result.length ? result : [{ kind: 'body', text: raw }];
}

export function inquiryMailPreview(parts: MailPart[]): string {
 return parts.filter(p => p.kind === 'body').map(p => p.text).join(' ').replace(/\s+/g, ' ').slice(0, 140) || (parts.some(p => p.kind === 'quote') ? '引用メール' : '署名のみ');
}
