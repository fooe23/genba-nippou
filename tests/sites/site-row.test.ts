import { describe, expect, it } from 'vitest';
import { siteColumns, siteFromRow, type SiteRow } from '@/lib/sites/site-row';

const row: SiteRow = {
  id: 's1',
  name: '〇〇様邸',
  client_name: null,
  project_name: null,
  project_no: null,
  overview: null,
  start_date: null,
  end_date: null,
  contract_type: null,
  status: 'active',
  common_start: null,
  common_end: null,
  common_break_min: null,
  common_gap_min: null,
  deleted_at: null,
  contract_status: null,
};

describe('siteColumns', () => {
  it('列があるときだけ estimate_required を読む（お金の列は読まない）', () => {
    expect(siteColumns(true)).toContain('estimate_required');
    expect(siteColumns(false)).not.toContain('estimate_required');
    expect(siteColumns(true)).not.toContain('contract_amount');
  });
});

describe('siteFromRow', () => {
  it('列なし（SQL の前）は null', () => {
    expect(siteFromRow(row).estimateRequired).toBeNull();
  });
  it('列ありは真偽', () => {
    expect(siteFromRow({ ...row, estimate_required: true }).estimateRequired).toBe(true);
    expect(siteFromRow({ ...row, estimate_required: false }).estimateRequired).toBe(false);
  });
});
