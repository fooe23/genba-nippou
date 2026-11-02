import { describe, expect, it } from 'vitest';
import { diffMasters } from '@/lib/import/diff';
import { selectableKeys, toPayload } from '@/lib/import/payload';
import type { CurrentMasters, ParsedRows } from '@/lib/import/types';

const current: CurrentMasters = {
  workers: [
    { name: '山田 太郎', trade: '大工', note: null, overtimeRate: 2500, active: true, rates: [{ amount: 18000, effectiveFrom: '2026-04-01' }] },
    { name: '鈴木 ', trade: '鳶', note: 'メモ', overtimeRate: null, active: false, rates: [] },
  ],
  suppliers: [{ name: '○○建材', category: '仕入', contact: null, note: null, active: true }],
  vehicles: [{ name: 'ハイエース', kind: 'バン', kmPerL: 9.5, note: null, active: true }],
  leaseItems: [{ name: '発電機', spec: '2kVA', note: null, active: true, rates: [{ amount: 3000, effectiveFrom: '2026-01-01' }] }],
};

function parsed(p: Partial<ParsedRows>): ParsedRows {
  return { workers: [], suppliers: [], vehicles: [], leaseItems: [], ...p };
}

describe('diffMasters', () => {
  it('新規：空でない項目を登録する値として並べる', () => {
    const p = diffMasters(parsed({ workers: [{ name: '田中', trade: '左官', dailyRate: 17000, overtimeRate: null, note: null }] }), current, '2026-11-03');
    expect(p.workers[0]).toMatchObject({ key: 'workers:田中', status: 'new', inactive: false });
    expect(p.workers[0].changes).toEqual([
      { label: '職種', before: '', after: '左官' },
      { label: '日当', before: '', after: '17,000（適用開始 2026/11/03）' },
    ]);
    expect(p.workers[0].payload).toEqual({ name: '田中', trade: '左官', note: null, daily_rate: 17000, overtime_rate: null });
  });

  it('更新：変わる項目だけ「変更前 → 変更後」（日当は適用開始日つき）', () => {
    const p = diffMasters(parsed({ workers: [{ name: '山田 太郎', trade: '型枠大工', dailyRate: 19000, overtimeRate: 2500, note: null }] }), current, '2026-11-03');
    expect(p.workers[0].status).toBe('updated');
    expect(p.workers[0].changes).toEqual([
      { label: '職種', before: '大工', after: '型枠大工' },
      { label: '日当', before: '18,000', after: '19,000（適用開始 2026/11/03）' },
    ]);
  });

  it('変更なし：空の項目は「変更しない」ので差分に出ない', () => {
    const p = diffMasters(parsed({ workers: [{ name: '山田 太郎', trade: null, dailyRate: null, overtimeRate: null, note: null }] }), current, '2026-11-03');
    expect(p.workers[0].status).toBe('unchanged');
    expect(p.workers[0].changes).toEqual([]);
  });

  it('日当が適用開始日時点の単価と同じなら履歴を足さない（変更なし）', () => {
    const p = diffMasters(parsed({ workers: [{ name: '山田 太郎', trade: '大工', dailyRate: 18000, overtimeRate: null, note: null }] }), current, '2026-11-03');
    expect(p.workers[0].status).toBe('unchanged');
  });

  it('適用開始日が履歴より前なら「未設定」からの変更', () => {
    const p = diffMasters(parsed({ workers: [{ name: '山田 太郎', trade: null, dailyRate: 18000, overtimeRate: null, note: null }] }), current, '2026-03-31');
    expect(p.workers[0].changes).toEqual([{ label: '日当', before: '未設定', after: '18,000（適用開始 2026/03/31）' }]);
  });

  it('残業単価 0 は null（空）扱いで差分に出さず、payload も null', () => {
    const p = diffMasters(parsed({ workers: [{ name: '山田 太郎', trade: null, dailyRate: null, overtimeRate: 0, note: null }] }), current, '2026-11-03');
    expect(p.workers[0].status).toBe('unchanged');
    expect(p.workers[0].payload.overtime_rate).toBeNull();
  });

  it('残業単価が違えば差分に出る', () => {
    const p = diffMasters(parsed({ workers: [{ name: '山田 太郎', trade: null, dailyRate: null, overtimeRate: 3000, note: null }] }), current, '2026-11-03');
    expect(p.workers[0].changes).toEqual([{ label: '残業単価', before: '2,500/H', after: '3,000/H' }]);
  });

  it('既存の名前は前後の半角スペースを除いて突き合わせ、無効の行は inactive', () => {
    const p = diffMasters(parsed({ workers: [{ name: '鈴木', trade: '鳶', dailyRate: null, overtimeRate: null, note: null }] }), current, '2026-11-03');
    expect(p.workers[0]).toMatchObject({ status: 'unchanged', inactive: true });
  });

  it('取引先・車両・リース品', () => {
    const p = diffMasters(
      parsed({
        suppliers: [{ name: '○○建材', category: '仕入', contact: '佐藤', note: null }],
        vehicles: [{ name: 'ハイエース', kind: 'バン', kmPerL: 10, note: null }],
        leaseItems: [
          { name: '発電機', spec: '2kVA', unitPrice: 3000, note: null },
          { name: '足場', spec: null, unitPrice: 500, note: null },
        ],
      }),
      current,
      '2026-11-03',
    );
    expect(p.suppliers[0].changes).toEqual([{ label: '連絡先', before: '未設定', after: '佐藤' }]);
    expect(p.vehicles[0].changes).toEqual([{ label: '燃費', before: '9.5 km/ℓ', after: '10 km/ℓ' }]);
    expect(p.leaseItems[0].status).toBe('unchanged');
    expect(p.leaseItems[1]).toMatchObject({ status: 'new', payload: { name: '足場', spec: null, note: null, unit_price: 500 } });
  });
});

describe('toPayload', () => {
  it('選択された新規・更新の行だけを RPC の形で返す', () => {
    const p = diffMasters(
      parsed({
        workers: [
          { name: '田中', trade: null, dailyRate: 17000, overtimeRate: null, note: null },
          { name: '山田 太郎', trade: '大工', dailyRate: null, overtimeRate: null, note: null },
          { name: '佐藤', trade: null, dailyRate: null, overtimeRate: null, note: null },
        ],
        leaseItems: [{ name: '足場', spec: null, unitPrice: 500, note: null }],
      }),
      current,
      '2026-11-03',
    );
    const keys = selectableKeys(p);
    expect(keys).toEqual(['workers:田中', 'workers:佐藤', 'leaseItems:足場']);
    const payload = toPayload(p, new Set(keys.filter((k) => k !== 'workers:佐藤').concat('workers:山田 太郎')));
    expect(payload).toEqual({
      workers: [{ name: '田中', trade: null, note: null, daily_rate: 17000, overtime_rate: null }],
      suppliers: [],
      vehicles: [],
      lease_items: [{ name: '足場', spec: null, note: null, unit_price: 500 }],
    });
  });
});
