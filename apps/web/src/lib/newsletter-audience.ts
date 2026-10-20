export type AudienceFilter=Partial<Record<'email'|'name'|'field'|'value'|'after'|'before'|'engagement'|'days',string>>;
export function audienceFilter(value:unknown):AudienceFilter{
 if(!value||typeof value!=='object'||Array.isArray(value))return {};
 const result:AudienceFilter={};
 for(const key of ['email','name','field','value','after','before','engagement','days'] as const){const text=String((value as Record<string,unknown>)[key]??'').trim();if(text)result[key]=text.slice(0,200);}
 return result;
}
export function savedAudience(query:string):AudienceFilter{try{return audienceFilter(JSON.parse(query||'{}'));}catch{return {};}}
