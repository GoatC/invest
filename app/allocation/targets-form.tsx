'use client';

import Link from 'next/link';
import { useActionState, useMemo, useState } from 'react';

import { AlertTiles } from '@/components/alert-tiles';
import { Bi } from '@/components/bi';
import { Field } from '@/components/field';
import type { AssetClassSettings } from '@/lib/data';
import { percent } from '@/lib/format';
import { bi, LABELS, SLEEVE, type Bilingual } from '@/lib/i18n';
import type { Security, Sleeve } from '@/lib/models/types';
import { parseNumber, parseTargets, targetFields } from '@/lib/validation';

import { saveTargets, type SettingsFormState } from './actions';

const INITIAL_STATE: SettingsFormState = { errors: {}, message: null };

/** A fraction as the percentage typed in the form: 0.28 → "28", 0.125 → "12.5". */
function typedPercent(value: number): string {
  return String(Number((value * 100).toFixed(2)));
}

export function TargetsForm({ classes, securities, r2Target }: { classes: AssetClassSettings[]; securities: Security[]; r2Target: number | null }) {
  const initial = useMemo(
    () =>
      Object.fromEntries(
        classes.flatMap((assetClass) => {
          const names = targetFields(assetClass.id);
          return [
            [names.target, typedPercent(assetClass.targetWeight)],
            [names.benchmark, assetClass.benchmarkTicker ?? ''],
          ];
        }),
      ),
    [classes],
  );
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [edited, setEdited] = useState<ReadonlySet<string>>(new Set());
  const [state, formAction, pending] = useActionState(saveTargets, INITIAL_STATE);
  const tickers = useMemo(() => new Set(securities.map((security) => security.ticker)), [securities]);
  const parsed = parseTargets(values, classes, tickers);

  function change(field: string, value: string) {
    setEdited((previous) => new Set(previous).add(field));
    setValues((previous) => ({ ...previous, [field]: value }));
  }

  function error(field: string): Bilingual | null {
    const server = edited.has(field) ? undefined : state.errors[field];
    const live = edited.has(field) && !parsed.ok ? parsed.errors[field] : undefined;
    return server ?? live ?? null;
  }

  // The totals as typed so far, blanks counting as 0.
  const typed = (id: string) => (parseNumber(values[targetFields(id).target]) ?? 0) / 100;
  const sleeveTotal = (sleeve: Sleeve) => classes.filter((assetClass) => assetClass.sleeve === sleeve).reduce((sum, assetClass) => sum + typed(assetClass.id), 0);
  const total = sleeveTotal('core') + sleeveTotal('satellite');
  const totalError = edited.size > 0 && !parsed.ok ? (parsed.errors['total'] ?? null) : (state.errors['total'] ?? null);
  const satelliteOffR2 = r2Target !== null && Math.abs(sleeveTotal('satellite') - r2Target) > 1e-9;

  return (
    <form action={formAction} onSubmit={() => setEdited(new Set())} className="form">
      {(['core', 'satellite'] as const).map((sleeve) => (
        <fieldset key={sleeve} className="form">
          <legend>
            <Bi {...SLEEVE[sleeve]} /> · {percent(sleeveTotal(sleeve))}
          </legend>
          {classes
            .filter((assetClass) => assetClass.sleeve === sleeve)
            .map((assetClass) => {
              const names = targetFields(assetClass.id);
              return (
                <div key={assetClass.id} className="form-grid">
                  <Field label={{ en: `${assetClass.nameEn}: target %`, zh: `${assetClass.nameZh}：目標 %` }} error={error(names.target)}>
                    <input name={names.target} inputMode="decimal" autoComplete="off" required value={values[names.target] ?? ''} onChange={(e) => change(names.target, e.target.value)} />
                  </Field>
                  <Field
                    label={{ en: 'Benchmark ETF', zh: '基準 ETF' }}
                    error={error(names.benchmark)}
                  >
                    <select name={names.benchmark} value={values[names.benchmark] ?? ''} onChange={(e) => change(names.benchmark, e.target.value)}>
                      <option value="">{bi({ en: 'None', zh: '無' })}</option>
                      {securities.map((security) => (
                        <option key={security.ticker} value={security.ticker}>
                          {`${security.ticker} · ${security.name}`}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              );
            })}
        </fieldset>
      ))}
      <p className={Math.abs(total - 1) > 1e-9 ? 'banner warn' : 'muted'} role="status">
        <Bi en={`Total ${percent(total, 2)} / 100%`} zh={`合計 ${percent(total, 2)} / 100%`} />
      </p>
      {totalError && (
        <p className="banner danger" role="alert">
          <Bi {...totalError} />
        </p>
      )}
      {satelliteOffR2 && r2Target !== null && (
        <AlertTiles
          items={[
            {
              key: 'r2',
              tone: 'info',
              code: 'R2',
              title: { en: 'Satellite targets', zh: '衛星目標合計' },
              value: percent(sleeveTotal('satellite')),
              chips: [
                { label: { en: 'R2 trims back to', zh: 'R2 減碼回' }, value: percent(r2Target) },
                { label: { en: 'Change R2 too', zh: '一併修改' }, value: 'R2' },
              ],
              href: '/rules#rule-R2',
            },
          ]}
        />
      )}
      {state.message && state.message !== state.errors['total'] && (
        <p className="banner danger" role="alert">
          <Bi {...state.message} />
        </p>
      )}
      <div className="row">
        <button type="submit" className="button primary" disabled={pending}>
          <Bi {...(pending ? LABELS.saving : LABELS.save)} />
        </button>
        <Link href="/allocation" className="button">
          <Bi {...LABELS.cancel} />
        </Link>
      </div>
    </form>
  );
}
