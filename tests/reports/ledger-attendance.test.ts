import { describe, it, expect } from 'vitest';
import { buildLedgerAttendance } from '@/lib/reports/ledger-attendance';
import { ledgerInput, ledgerReport, ownLabor, unnamedLabor } from './ledger-fixture';

const ALL = { kind: 'all' } as const;

describe('buildLedgerAttendance（出面一覧）', () => {
  it('〇〇様邸の 1 日：Ｓさん（自社）と 〇〇工務店（名前なし）（請負・3 名）の 2 行、合計 2.0・うち請負 1.0', () => {
    const [m, ...rest] = buildLedgerAttendance(ledgerInput(), ALL);
    expect(rest).toEqual([]);
    expect(m.month).toBe('2026-11');
    expect(m.days).toHaveLength(30);
    expect(m.days[0]).toBe('2026-11-01');
    expect(m.days[29]).toBe('2026-11-30');
    expect(m.rows.map((r) => [r.name, r.affiliationLabel, r.kind, r.unnamed, r.manDays, r.workDays])).toEqual([
      ['Ｓさん', '自社', '自社', false, 1, 1],
      ['〇〇工務店（名前なし）', '〇〇工務店', '請負', true, 1, 1],
    ]);
    expect(m.rows[1].byDate['2026-11-10']).toEqual({ manDays: 1, headcount: 3 });
    expect(m.rows[0].byDate['2026-11-10']).toEqual({ manDays: 1, headcount: 1 });
    expect(m.dayTotals['2026-11-10']).toBe(2);
    expect(m.ukeoiDayTotals['2026-11-10']).toBe(1);
    expect(m.manDays).toBe(2);
    expect(m.ukeoiManDays).toBe(1);
  });

  it('同じ人が常用の日と請負の日 → 区分ごとに 2 行（常用 → 請負の順）', () => {
    const partner = (date: string, contract: 'jouyou' | 'ukeoi', manDays: number) =>
      ledgerReport(date, [
        ownLabor({ workerId: 'w9', workerName: '鈴木', affiliation: 'partner', supplierId: 'pK', laborContract: contract, stored: { amount: 0, manDays, overtimeHours: 0, hours: 8 } } as never),
      ]);
    const [m] = buildLedgerAttendance(ledgerInput([partner('2026-11-03', 'jouyou', 1), partner('2026-11-04', 'ukeoi', 0.5), partner('2026-11-05', null as never, 1)]), ALL);
    expect(m.rows.map((r) => [r.name, r.affiliationLabel, r.kind, r.manDays, r.workDays])).toEqual([
      ['鈴木', '〇〇工務店', '常用', 2, 2],
      ['鈴木', '〇〇工務店', '請負', 0.5, 1],
    ]);
    expect(m.ukeoiManDays).toBe(0.5);
    expect(m.manDays).toBe(2.5);
  });

  it('並びは 自社 → 協力会社（名前順）→ 所属なし、その中は名前順', () => {
    const r = ledgerReport('2026-11-02', [
      ownLabor({ workerId: null, workerName: '飛び込み', affiliation: null } as never),
      unnamedLabor(),
      ownLabor({ workerId: 'w2', workerName: '山田' } as never),
      ownLabor({ workerId: 'w3', workerName: '阿部', affiliation: 'partner', supplierId: 'pA', laborContract: 'jouyou' } as never),
      ownLabor(),
    ]);
    const input = ledgerInput([r]);
    input.suppliers.push({ ...input.suppliers[1], id: 'pA', name: 'わかば建設' });
    const [m] = buildLedgerAttendance(input, ALL);
    expect(m.rows.map((x) => `${x.affiliationLabel}/${x.name}`)).toEqual([
      '自社/Ｓさん',
      '自社/山田',
      '〇〇工務店/〇〇工務店（名前なし）',
      'わかば建設/阿部',
      '所属なし/飛び込み',
    ]);
  });

  it('2 か月の日報 → 月が 2 つ（days はその月の全日）。月の期間 → その月だけ。労務の行が無い月は出さない', () => {
    const input = ledgerInput([
      ledgerReport('2026-10-31', [ownLabor()]),
      ledgerReport('2026-11-10', [ownLabor(), unnamedLabor()]),
      ledgerReport('2026-12-01', []),
    ]);
    const all = buildLedgerAttendance(input, ALL);
    expect(all.map((m) => [m.month, m.days.length, m.manDays])).toEqual([
      ['2026-10', 31, 1],
      ['2026-11', 30, 2],
    ]);
    const oct = buildLedgerAttendance(input, { kind: 'month', month: '2026-10' });
    expect(oct.map((m) => m.month)).toEqual(['2026-10']);
    expect(buildLedgerAttendance(input, { kind: 'month', month: '2026-12' })).toEqual([]);
  });

  it('人工は小数 2 桁（足すたびに丸める。attendance() と同じ）。同じ日に同じ人が 2 行なら足す', () => {
    const third = { amount: 0, manDays: 0.333333, overtimeHours: 0, hours: 2.67 };
    const [m] = buildLedgerAttendance(ledgerInput([ledgerReport('2026-11-10', [ownLabor({ stored: third } as never), ownLabor({ stored: third } as never)])]), ALL);
    expect(m.rows[0].byDate['2026-11-10']).toEqual({ manDays: 0.66, headcount: 2 });
    expect(m.rows[0].workDays).toBe(1);
  });
});
