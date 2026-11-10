import { describe, expect, it } from 'vitest';
import {
  budgetManDaysSummary,
  canOverrideProgress,
  canViewBudget,
  manDaysText,
  outsideTag,
  parsePercentInput,
  percentText,
  profitClass,
  progressBar,
  statusNote,
  statusTag,
  yenText,
} from '@/lib/budget/budget-view';
import type { PerformerRow } from '@/lib/budget/budget-model';

const employee = { isAdmin: false, accountType: 'employee' as const };
const partner = { isAdmin: false, accountType: 'partner' as const };
const admin = { isAdmin: true, accountType: 'employee' as const };

describe('書式', () => {
  it('円：null は —、負は全角のマイナス', () => {
    expect(yenText(null)).toBe('—');
    expect(yenText(0)).toBe('¥0');
    expect(yenText(2165658)).toBe('¥2,165,658');
    expect(yenText(-1005143)).toBe('−¥1,005,143');
  });
  it('人工：小数 1〜2 桁', () => {
    expect(manDaysText(73)).toBe('73.0 人工');
    expect(manDaysText(129.7)).toBe('129.7 人工');
    expect(manDaysText(0.25)).toBe('0.25 人工');
    expect(manDaysText(0.333)).toBe('0.33 人工');
  });
  it('%：10 以上は整数、10 未満は小数 1 桁、null は —', () => {
    expect(percentText(91.4)).toBe('91%');
    expect(percentText(120.6)).toBe('121%');
    expect(percentText(5.33)).toBe('5.3%');
    expect(percentText(0)).toBe('0%');
    expect(percentText(null)).toBe('—');
  });
});

describe('進み具合の棒', () => {
  it('使っている % と数量からの線、数量から 100 超は右端で印', () => {
    expect(progressBar({ used: 95, fromQty: 91, override: 95 })).toEqual({ used: 95, qtyMark: 91, overQty: false });
    expect(progressBar({ used: 100, fromQty: 130, override: null })).toEqual({ used: 100, qtyMark: 100, overQty: true });
    expect(progressBar({ used: null, fromQty: null, override: null })).toEqual({ used: null, qtyMark: null, overQty: false });
  });
});

describe('判定の札', () => {
  it('順調・予算超え・赤字の見込み・—', () => {
    expect(statusTag('ok')).toEqual({ label: '順調', tone: 'ok' });
    expect(statusTag('overBudget')).toEqual({ label: '予算超え', tone: 'warn' });
    expect(statusTag('loss')).toEqual({ label: '赤字の見込み', tone: 'ng' });
    expect(statusTag('none')).toEqual({ label: '—', tone: 'none' });
  });
  it('予算外の作業は実績があれば「追加の請求を検討」', () => {
    expect(outsideTag(695000)).toEqual({ label: '追加の請求を検討', tone: 'warn' });
    expect(outsideTag(0)).toBeNull();
  });
  it('粗利の色', () => {
    expect(profitClass(-1)).toContain('red');
    expect(profitClass(0)).toContain('green');
    expect(profitClass(null)).toBe('');
  });
});

describe('予算の人工の内わけ', () => {
  const p = (name: string, budgetManDays: number | null): PerformerRow => ({
    performer: 'own', supplierId: null, name, budgetAmount: 0, budgetManDays, actualAmount: 0, actualManDays: 0, item: 'labor', issuePaid: 0, forecast: null, overContract: false, outsideContract: false,
  });
  it('人工のある施工者だけ', () => {
    expect(budgetManDaysSummary([p('自社', 80), p('〇〇塗装', null), p('△△工業', 10)])).toBe('自社 80.0 人工・△△工業 10.0 人工');
    expect(budgetManDaysSummary([p('〇〇塗装', null)])).toBe('');
  });
});

describe('権限の判定', () => {
  it('予算と実績を見られるのは社員と管理者（協力会社は notFound）', () => {
    expect(canViewBudget(employee)).toBe(true);
    expect(canViewBudget(admin)).toBe(true);
    expect(canViewBudget(partner)).toBe(false);
    expect(canViewBudget({ isAdmin: true, accountType: 'partner' })).toBe(true);
  });
  it('% の上書きは管理者と、その現場の確認・承認の人（社員）だけ', () => {
    expect(canOverrideProgress(admin, null)).toBe(true);
    expect(canOverrideProgress(employee, 'reviewer')).toBe(true);
    expect(canOverrideProgress(employee, 'approver')).toBe(true);
    expect(canOverrideProgress(employee, 'staff')).toBe(false);
    expect(canOverrideProgress(employee, null)).toBe(false);
    expect(canOverrideProgress(partner, 'approver')).toBe(false);
  });
});

describe('判定の注記', () => {
  it('内訳の識別がまだの工種（見込みあり・none）だけ「内訳の識別がまだです」', () => {
    expect(statusNote({ status: 'none', forecast: 100, contractItemCount: 0 })).toBe('内訳の識別がまだです');
    expect(statusNote({ status: 'none', forecast: null, contractItemCount: 0 })).toBeNull();
    expect(statusNote({ status: 'none', forecast: null, contractItemCount: 2 })).toBeNull();
    expect(statusNote({ status: 'ok', forecast: 0, contractItemCount: 0 })).toBeNull();
  });
});

describe('% の入力', () => {
  it('0〜100、全角・% 可、小数 1 桁まで', () => {
    expect(parsePercentInput('70')).toEqual({ ok: true, value: 70 });
    expect(parsePercentInput('７０％')).toEqual({ ok: true, value: 70 });
    expect(parsePercentInput('0')).toEqual({ ok: true, value: 0 });
    expect(parsePercentInput('100')).toEqual({ ok: true, value: 100 });
    expect(parsePercentInput('62.5')).toEqual({ ok: true, value: 62.5 });
    expect(parsePercentInput('').ok).toBe(false);
    expect(parsePercentInput('101').ok).toBe(false);
    expect(parsePercentInput('-1').ok).toBe(false);
    expect(parsePercentInput('abc').ok).toBe(false);
    expect(parsePercentInput('12.34').ok).toBe(false);
  });

  it('指数・16 進・符号・先頭や末尾の小数点は断る', () => {
    for (const raw of ['1e2', '1E1', '0x10', '+5', '.5', '5.', 'Infinity', '5 0.0.1', '1_0']) {
      expect(parsePercentInput(raw).ok, raw).toBe(false);
    }
    expect(parsePercentInput(' 5 0 ')).toEqual({ ok: true, value: 50 }); // 空白は除く
    expect(parsePercentInput('０５')).toEqual({ ok: true, value: 5 });
  });
});
