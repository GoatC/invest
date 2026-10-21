'use client';

import { useActionState } from 'react';

import type { DeleteState } from '@/lib/forms';
import { bi, LABELS, type Bilingual } from '@/lib/i18n';

import { Bi } from './bi';

const INITIAL_STATE: DeleteState = { message: null };

/** A delete button that asks first; the server action may refuse with a reason. */
export function DeleteForm({ id, action, confirm }: { id: number | string; action: (previous: DeleteState, formData: FormData) => Promise<DeleteState>; confirm: Bilingual }) {
  const [state, formAction, pending] = useActionState(action, INITIAL_STATE);
  return (
    <form
      action={formAction}
      className="form"
      onSubmit={(event) => {
        if (!window.confirm(bi(confirm))) event.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <p className="muted small">
        <Bi en="A deleted entry stays in the edit history." zh="刪除的資料會保留在修改紀錄中。" />
      </p>
      {state.message && (
        <p className="banner danger" role="alert">
          <Bi {...state.message} />
        </p>
      )}
      <div>
        <button type="submit" className="button danger" disabled={pending}>
          <Bi {...LABELS.delete} />
        </button>
      </div>
    </form>
  );
}
