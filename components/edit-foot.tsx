import type { ReactNode } from 'react';

import type { AuditEntry } from '@/lib/data/audit';
import type { DeleteState } from '@/lib/forms';
import { LABELS, type Bilingual } from '@/lib/i18n';

import { Bi } from './bi';
import { DeleteForm } from './delete-form';
import { History } from './history';

/** An edit page's last two cards: delete (it asks first; the history keeps the entry) and the entry's edit history. */
export function EditFoot({ id, action, confirm, history, children }: { id: number | string; action: (previous: DeleteState, formData: FormData) => Promise<DeleteState>; confirm: Bilingual; history: AuditEntry[]; children?: ReactNode }) {
  return (
    <>
      <section className="card">
        <h2>
          <Bi {...LABELS.delete} />
        </h2>
        {children}
        <DeleteForm id={id} action={action} confirm={confirm} />
      </section>
      <section className="card">
        <h2>
          <Bi {...LABELS.history} />
        </h2>
        <History entries={history} />
      </section>
    </>
  );
}
