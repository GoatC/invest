import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { bi, LABELS, textMode } from './i18n';

describe('textMode (the Chinese-first rule)', () => {
  it('keeps names in both languages', () => {
    assert.equal(textMode({ en: 'Regular pool', zh: '一般投入資金池' }), 'both');
    assert.equal(textMode(LABELS.fxRate), 'both');
    assert.equal(textMode({ en: 'Long (buy low, sell high)', zh: '做多（買低賣高）' }), 'both');
    assert.equal(bi({ en: 'Open the proposals', zh: '查看提案' }), 'Open the proposals 查看提案');
    assert.equal(bi(LABELS.saving), 'Saving… 儲存中…');
  });

  it('shows sentences, figure lines and long phrases in Chinese alone', () => {
    assert.equal(bi({ en: 'Trade added.', zh: '已新增交易。' }), '已新增交易。');
    assert.equal(bi({ en: 'Already above a limit before this trade:', zh: '這筆交易之前就已超過限制：' }), '這筆交易之前就已超過限制：');
    assert.equal(textMode({ en: 'trim ≈ NT$17,750 → 20%', zh: '減碼約 NT$17,750 → 20%' }), 'zh');
    assert.equal(textMode({ en: 'R2 trigger 25%', zh: 'R2 觸發點 25%' }), 'zh');
    assert.equal(textMode({ en: 'Show all 120 trades', zh: '顯示全部 120 筆交易' }), 'zh');
    assert.equal(textMode({ en: 'Tap a ticker for its analyses', zh: '點代號看這檔的分析' }), 'zh');
  });

  it('shows a name the same in both once, and keeps a label bilingual however long', () => {
    assert.equal(bi({ en: 'FinMind', zh: 'FinMind' }), 'FinMind');
    assert.equal(textMode({ en: '95% 1-month VaR', zh: '95% 一個月風險值' }, true), 'both');
    assert.equal(bi({ en: 'Expected return of the class, until loaded, %', zh: '類別預期報酬（資料載入前，%）' }, true), 'Expected return of the class, until loaded, % 類別預期報酬（資料載入前，%）');
  });
});
