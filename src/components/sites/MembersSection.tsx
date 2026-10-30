'use client';

import { useState } from 'react';
import { setSiteMember } from '@/lib/db/sites-actions';
import type { SiteMember } from '@/lib/db/sites';
import { SITE_ROLES } from '@/lib/db/sites-schemas';
import type { SiteRole } from '@/lib/types';
import {
  EmptyText, ErrorText, Field, inputClass, primaryButtonClass, secondaryButtonClass, useRunner,
} from '@/components/masters/common';
import { ROLE_LABELS } from './labels';

interface ProfileOption { id: string; name: string; email: string; }

function isRole(v: string): v is SiteRole {
  return (SITE_ROLES as readonly string[]).includes(v);
}

/** ② 担当者: 役割の変更・外す・社員を選んで追加。 */
export function MembersSection({
  siteId,
  members,
  profiles,
}: {
  siteId: string;
  members: SiteMember[];
  profiles: ProfileOption[];
}) {
  const { pending, error, setError, run } = useRunner();
  const [newUserId, setNewUserId] = useState('');
  const [newRole, setNewRole] = useState<SiteRole>('staff');
  const memberIds = new Set(members.map((m) => m.userId));
  const candidates = profiles.filter((p) => !memberIds.has(p.id));

  function changeRole(userId: string, role: SiteRole) {
    run(() => setSiteMember(siteId, userId, role));
  }

  function remove(m: SiteMember) {
    if (!window.confirm(`${m.name || m.email} をこの現場の担当から外します。よろしいですか？`)) return;
    run(() => setSiteMember(siteId, m.userId, null));
  }

  function add() {
    if (newUserId === '') {
      setError('追加する社員を選んでください');
      return;
    }
    run(
      () => setSiteMember(siteId, newUserId, newRole),
      () => {
        setNewUserId('');
        setNewRole('staff');
      },
    );
  }

  return (
    <div className="space-y-4">
      {members.length === 0 ? (
        <EmptyText>担当者がまだいません。</EmptyText>
      ) : (
        <ul>
          {members.map((m) => (
            <li
              key={m.userId}
              className="flex flex-wrap items-center gap-2 border-b border-gray-300 py-2 dark:border-gray-700"
            >
              <span className="min-w-0 flex-1 basis-40">
                <span className="block truncate font-bold">{m.name || '（名前未設定）'}</span>
                <span className="block truncate text-sm text-gray-600 dark:text-gray-400">{m.email}</span>
              </span>
              <select
                aria-label={`${m.name || m.email} の役割`}
                value={m.role}
                disabled={pending}
                onChange={(e) => {
                  if (isRole(e.target.value)) changeRole(m.userId, e.target.value);
                }}
                className={`${inputClass} w-28`}
              >
                {SITE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
              <button type="button" disabled={pending} onClick={() => remove(m)} className={secondaryButtonClass}>
                外す
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-3 rounded-lg bg-gray-100 p-3 dark:bg-gray-900">
        <p className="text-sm font-bold">担当者を追加</p>
        <Field label="社員">
          <select value={newUserId} onChange={(e) => setNewUserId(e.target.value)} className={inputClass}>
            <option value="">選択してください</option>
            {candidates.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name ? `${p.name}（${p.email}）` : p.email}
              </option>
            ))}
          </select>
        </Field>
        <Field label="役割">
          <select
            value={newRole}
            onChange={(e) => {
              if (isRole(e.target.value)) setNewRole(e.target.value);
            }}
            className={inputClass}
          >
            {SITE_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </Field>
        <ErrorText message={error} />
        <button type="button" disabled={pending} onClick={add} className={`${primaryButtonClass} w-full`}>
          {pending ? '処理中…' : '追加'}
        </button>
      </div>
    </div>
  );
}
