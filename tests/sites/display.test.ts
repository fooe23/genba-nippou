import { describe, expect, it } from 'vitest';
import { contractAmountText, siteForViewer, siteSubline, siteTitle } from '@/lib/sites/display';

describe('siteTitle', () => {
  it('工事名があれば「工事名 ／ 現場名」', () => {
    expect(siteTitle({ name: '村山様邸', projectName: '外構改修工事' })).toBe('外構改修工事 ／ 村山様邸');
  });
  it('工事名が空・空白・null なら現場名だけ', () => {
    expect(siteTitle({ name: '村山様邸', projectName: null })).toBe('村山様邸');
    expect(siteTitle({ name: '村山様邸', projectName: '' })).toBe('村山様邸');
    expect(siteTitle({ name: '村山様邸', projectName: '  ' })).toBe('村山様邸');
  });
  it('前後の空白は落とす', () => {
    expect(siteTitle({ name: ' 村山様邸 ', projectName: ' 母屋外壁・屋根改修工事 ' })).toBe('母屋外壁・屋根改修工事 ／ 村山様邸');
  });
});

describe('siteSubline', () => {
  const site = { clientName: '村山 太郎', contractAmount: 1234567 };
  it('社員・管理者は客先と請負金額', () => {
    expect(siteSubline(site, { showAmount: true })).toBe('客先：村山 太郎 ｜ 請負金額：¥1,234,567');
  });
  it('協力会社は客先だけ（請負金額の文字も出さない）', () => {
    const text = siteSubline(site, { showAmount: false });
    expect(text).toBe('客先：村山 太郎');
    expect(text).not.toContain('請負金額');
  });
  it('客先名が空なら「客先：—」', () => {
    expect(siteSubline({ clientName: null, contractAmount: null }, { showAmount: false })).toBe('客先：—');
    expect(siteSubline({ clientName: ' ', contractAmount: null }, { showAmount: false })).toBe('客先：—');
  });
  it('請負金額が未入力なら「—」、0 は ¥0', () => {
    expect(siteSubline({ clientName: 'A', contractAmount: null }, { showAmount: true })).toBe('客先：A ｜ 請負金額：—');
    expect(siteSubline({ clientName: 'A', contractAmount: 0 }, { showAmount: true })).toBe('客先：A ｜ 請負金額：¥0');
  });
});

describe('contractAmountText', () => {
  it('null は —、数値は円表示', () => {
    expect(contractAmountText(null)).toBe('—');
    expect(contractAmountText(5000)).toBe('¥5,000');
  });
});

describe('siteForViewer', () => {
  const site = { id: 's1', name: '村山様邸', contractAmount: 100, estimatedAmount: 90, defaultDailyRate: 25000 };
  it('社員・管理者はそのまま', () => {
    expect(siteForViewer(site, true)).toBe(site);
  });
  it('協力会社はお金の項目を null にした写し（元は変えない）', () => {
    const out = siteForViewer(site, false);
    expect(out).toEqual({ id: 's1', name: '村山様邸', contractAmount: null, estimatedAmount: null, defaultDailyRate: null });
    expect(site.contractAmount).toBe(100);
  });
});
