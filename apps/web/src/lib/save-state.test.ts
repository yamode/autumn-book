import { describe, expect, it } from 'vitest';
import { saveStateLabel } from './save-state';

describe('保存ボタンの中の言葉', () => {
	it('ボタンの文字の動詞に合わせる', () => {
		expect(saveStateLabel('保存', 'saving')).toBe('保存中…');
		expect(saveStateLabel('保存する', 'done')).toBe('✓ 保存しました');
		expect(saveStateLabel('施設の既定を保存', 'error')).toBe('保存できませんでした');
		expect(saveStateLabel('＋ 段階を追加', 'done')).toBe('✓ 追加しました');
		expect(saveStateLabel('削除', 'saving')).toBe('削除中…');
		expect(saveStateLabel('全客室に出す', 'done')).toBe('✓ 完了しました');
		expect(saveStateLabel('', 'saving')).toBe('処理中…');
	});
});
