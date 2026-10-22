import {test,expect} from 'vitest';
import {isJapaneseText} from './inquiry-text';
test('日本語の本文だけを翻訳不要と判定する',()=>{
 expect(isJapaneseText('株式会社山人 御中\n\nお世話になっております。SBY Promotionsの高木と申します。')).toBe(true);
 expect(isJapaneseText('Hello, I would like to book a room for 2 people on Nov 3.')).toBe(false);
 expect(isJapaneseText('您好，我想预订11月3日的房间，两位成人。请问有空房吗？')).toBe(false);
 expect(isJapaneseText('Hi, we stayed at ヤマド last year. Could we book again for December? Thanks, John')).toBe(false);
 expect(isJapaneseText('予約変更希望')).toBe(false);
});
