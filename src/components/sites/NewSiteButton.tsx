'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { primaryButtonClass } from '@/components/masters/common';
import { EditDialog } from '@/components/masters/EditDialog';
import { SiteForm } from './SiteForm';

/** 「新規作成」ボタンと作成ダイアログ。作成後は編集ページへ移動する。 */
export function NewSiteButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={primaryButtonClass}>
        新規作成
      </button>
      <EditDialog open={open} title="現場を新規作成" onClose={() => setOpen(false)}>
        <SiteForm
          site={null}
          onSaved={(id) => {
            setOpen(false);
            router.push(`/admin/sites/${id}`);
          }}
        />
      </EditDialog>
    </>
  );
}
