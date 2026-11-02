import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db/masters', () => ({ listLeaseItems: vi.fn(), listSuppliers: vi.fn(), listUnits: vi.fn(), listVehicles: vi.fn(), listWeather: vi.fn(), listWorkers: vi.fn() }));
vi.mock('@/lib/db/reports', () => ({ listIssuesForReport: vi.fn(), listOpenIssues: vi.fn(), listReportHeads: vi.fn() }));
vi.mock('@/lib/db/sites', () => ({ getSiteMasters: vi.fn() }));
vi.mock('@/lib/db/settings', () => ({ getSettings: vi.fn() }));

const { forSite } = await import('@/lib/report/form-props');

const items = [
  { id: 'a', active: true },
  { id: 'b', active: false },
  { id: 'c', active: true },
];

describe('forSite（現場で使うマスターの絞り込み）', () => {
  it('選択があるときは、選択順のうち有効なもの＋使用中のもの', () => {
    expect(forSite(items, ['c', 'b', 'a'], new Set()).map((i) => i.id)).toEqual(['c', 'a']);
    expect(forSite(items, ['c', 'b'], new Set(['b'])).map((i) => i.id)).toEqual(['c', 'b']);
  });
  it('何も選んでいないときは、有効なもの全部（マスターの並び）', () => {
    expect(forSite(items, [], new Set()).map((i) => i.id)).toEqual(['a', 'c']);
  });
  it('何も選んでいなくても、使用中の無効なものは末尾に残す', () => {
    expect(forSite(items, [], new Set(['b'])).map((i) => i.id)).toEqual(['a', 'c', 'b']);
  });
});
