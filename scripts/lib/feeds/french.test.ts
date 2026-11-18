import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { strToU8, zipSync } from 'fflate';

import { FeedError } from './types.ts';
import { frenchSeries, frenchUrl } from './french.ts';

const CSV = `This file was created using the 202609 Bloomberg database.

Missing data are indicated by -99.99.



,Mkt-RF,SMB,HML,RMW,CMA,RF
199007    ,0.77    ,0.63   ,-0.40    ,0.27    ,1.43    ,0.68
199008  ,-10.77   ,-1.45    ,0.53   ,-0.01    ,1.21    ,0.66
199009  ,-11.88    ,1.29    ,-99.99   ,0.18    ,2.19    ,0.60
202609    ,1.50    ,-0.50   ,0.25    ,0.10    ,-0.05    ,0.30

 Annual Factors: January-December 
,Mkt-RF,SMB,HML,RMW,CMA,RF
1991 ,12.50 ,3.00 ,1.00 ,2.00 ,3.00 ,5.00
`;

function zipOf(text: string): Uint8Array {
  return zipSync({ 'Developed_5_Factors.csv': strToU8(text) });
}

describe('Ken French feed', () => {
  it('reads the monthly block as fractions in six series, stopping before the annual rows', () => {
    const points = frenchSeries(zipOf(CSV), 'developed', '1990-01');
    // Three complete months: 1990-07, 1990-08 and 2026-09 (1990-09 has a missing HML).
    assert.deepEqual([...new Set(points.map((point) => point.month))], ['1990-07', '1990-08', '2026-09']);
    assert.equal(points.length, 18);
    const first = points.filter((point) => point.month === '1990-07');
    assert.deepEqual(first.map((point) => point.series), ['ff5_developed_mkt', 'ff5_developed_smb', 'ff5_developed_hml', 'ff5_developed_rmw', 'ff5_developed_cma', 'ff5_developed_rf']);
    assert.deepEqual(first.map((point) => point.value), [0.0077, 0.0063, -0.004, 0.0027, 0.0143, 0.0068]);
    assert.ok(points.every((point) => point.source === 'french'));
    assert.ok(!points.some((point) => point.month === '1991-01'));
  });

  it('keeps only the months from a date on', () => {
    const points = frenchSeries(zipOf(CSV), 'developed', '2020-01');
    assert.deepEqual([...new Set(points.map((point) => point.month))], ['2026-09']);
  });

  it('names the library file of each region and fails plainly when there is nothing to read', () => {
    assert.equal(frenchUrl('us'), 'https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/F-F_Research_Data_5_Factors_2x3_CSV.zip');
    assert.equal(frenchUrl('emerging').endsWith('Emerging_5_Factors_CSV.zip'), true);
    assert.throws(() => frenchSeries(zipOf('nothing useful\n'), 'us', '2020-01'), FeedError);
    assert.throws(() => frenchSeries(zipSync({ 'readme.txt': strToU8('x') }), 'us', '2020-01'), /no CSV/);
  });
});
