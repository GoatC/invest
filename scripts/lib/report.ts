import { SATELLITE_NOTE, TICKERS, UNLISTED_NOTE } from './tickers.ts';
import type { CallRecord, Coverage, Mark, RunReport, SourceResult, SourceStatus, TickerSpec } from './types.ts';

const MARK_ICON: Record<Mark, string> = { yes: '✅', no: '❌', na: '—', skipped: '⏭️', failed: '⚠️', unchecked: '·' };

const STATUS_LABEL: Record<SourceStatus, string> = {
  ok: '✅ ok',
  partial: '🟡 partial 部分',
  failed: '❌ failed 失敗',
  skipped: '⏭️ skipped 略過',
};

const LEGEND =
  'Legend 圖例: ✅ covered 有涵蓋 · ❌ not found 找不到 · — not applicable 不適用 · ⏭️ skipped, key not set 略過（未設金鑰） · ' +
  '⚠️ call failed, coverage unknown 呼叫失敗 · · not checked this run 本次未檢查';

/** Escapes a value for a Markdown table cell. */
export function cell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(1)} kB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** What a coverage-table cell shows; fills in the cells a probe left unset. */
export function coverageOf(source: SourceResult, ticker: TickerSpec): Coverage {
  const set = source.coverage[ticker.id];
  if (set) return set;
  if (!source.coverageMarkets?.includes(ticker.market)) return { mark: 'na' };
  if (source.coverageKinds && !source.coverageKinds.includes(ticker.kind)) return { mark: 'na' };
  if (source.status === 'skipped') return { mark: 'skipped' };
  if (source.status === 'failed') return { mark: 'failed' };
  return { mark: 'unchecked' };
}

/** One row per ticker, one column per source; a source that applies to none of these tickers gets no column. */
function coverageTable(sources: readonly SourceResult[], tickers: readonly TickerSpec[]): string[] {
  const columns = sources.filter((source) => tickers.some((ticker) => coverageOf(source, ticker).mark !== 'na'));
  const head = ['Ticker 標的', 'Role 角色', 'Market 市場', ...columns.map((source) => source.short)];
  const lines = [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`];
  for (const ticker of tickers) {
    const marks = columns.map((source) => MARK_ICON[coverageOf(source, ticker).mark]);
    lines.push(`| ${[`**${ticker.label}**`, ticker.role, ticker.market, ...marks].map(cell).join(' | ')} |`);
  }
  return lines;
}

/** Per-ticker details; failed calls are left out because each source section already shows its errors. */
function coverageDetails(sources: readonly SourceResult[], tickers: readonly TickerSpec[]): string[] {
  const lines: string[] = [];
  for (const ticker of tickers) {
    const parts = sources.flatMap((source) => {
      const coverage = source.coverage[ticker.id];
      return coverage?.detail && coverage.mark !== 'failed' ? [`${source.short} ${MARK_ICON[coverage.mark]} ${coverage.detail}`] : [];
    });
    if (parts.length > 0) lines.push(`- **${ticker.label}**: ${parts.join(' · ')}`);
  }
  return lines;
}

/** Answers the PRD open question "free price source for LSE-listed AGGU" from this run's evidence. */
export function agguVerdict(sources: readonly SourceResult[], tickers: readonly TickerSpec[] = TICKERS): string[] {
  const aggu = tickers.find((ticker) => ticker.id === 'AGGU');
  const byId = (id: string) => sources.find((source) => source.id === id);
  const coverageFrom = (id: string): Coverage => {
    const source = byId(id);
    return source && aggu ? coverageOf(source, aggu) : { mark: 'unchecked' };
  };
  const candidates: Array<{ name: string; coverage: Coverage }> = [
    { name: 'Alpha Vantage, AGGU.LON (PRD primary price source)', coverage: coverageFrom('alphavantage') },
    { name: 'Financial Modeling Prep, AGGU.L', coverage: coverageFrom('fmp') },
    { name: 'FinMind US list (backup source)', coverage: coverageFrom('finmind') },
  ];
  const nav = byId('issuers')?.series.find((point) => point.name.startsWith('AGGU NAV'));
  const lines = candidates.map(({ name, coverage }) => `- ${MARK_ICON[coverage.mark]} ${name}${coverage.detail ? `: ${coverage.detail}` : ''}`);
  lines.push(
    nav?.latestDate
      ? `- ✅ iShares NAV history (issuer file): latest ${nav.latestDate}${nav.latestValue ? `, ${nav.latestValue}` : ''}`
      : '- · iShares NAV history (issuer file): not confirmed this run',
  );
  const market = candidates.slice(0, 2).find((candidate) => candidate.coverage.mark === 'yes');
  let verdict: string;
  if (market) verdict = `**Verdict 結論:** ${market.name} serves AGGU prices on the free tier. 可用此來源取得 AGGU 價格。`;
  else if (nav?.latestDate)
    verdict =
      '**Verdict 結論:** no free market-price feed confirmed for AGGU yet; the issuer’s daily NAV history works as a fallback valuation. ' +
      '尚未確認免費的 AGGU 市價來源；可先用 iShares 每日淨值估值。';
  else verdict = '**Verdict 結論:** unresolved this run; re-run with the missing keys. 本次無法判定，請補上金鑰後重跑。';
  return [...lines, '', verdict];
}

/** Latest point per series; a market-level source that produced none still gets a row, so gaps stay visible. */
function seriesTable(sources: readonly SourceResult[]): string[] {
  const lines = ['| Series 資料序列 | Source 來源 | Latest date 最新日期 | Latest value 最新值 |', '| --- | --- | --- | --- |'];
  for (const source of sources) {
    const points = source.series.length > 0 || source.coverageMarkets ? source.series : [{ name: source.row }];
    for (const point of points) {
      const value = point.latestValue ? [point.latestValue, point.unit].filter(Boolean).join(' ') : `— (${STATUS_LABEL[source.status]})`;
      lines.push(`| ${[point.name, source.short, point.latestDate ?? '—', value].map(cell).join(' | ')} |`);
    }
  }
  return lines;
}

function observedSummary(source: SourceResult): string {
  const headers = new Set<string>();
  for (const call of source.calls) {
    for (const [name, value] of Object.entries(call.rateLimitHeaders)) headers.add(`${name}: ${value}`);
  }
  const errors = new Set(source.calls.filter((call) => !call.ok && call.error).map((call) => call.error ?? ''));
  const parts = [...source.observedLimits, ...headers, ...[...errors].map((error) => `error: ${error}`)];
  if (source.calls.length === 0) return '—';
  return parts.length > 0 ? parts.join('; ') : 'no rate-limit headers 無流量標頭';
}

function summaryTable(sources: readonly SourceResult[]): string[] {
  const lines = [
    '| # | Source 來源 | Section 6 data 資料 | Status 狀態 | Requests 請求數 | Documented limit 官方限制 | Observed this run 本次實測 |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];
  sources.forEach((source, i) => {
    const cells = [
      String(i + 1),
      source.name,
      source.row,
      STATUS_LABEL[source.status],
      String(source.calls.length),
      source.documentedLimit,
      observedSummary(source),
    ];
    lines.push(`| ${cells.map(cell).join(' | ')} |`);
  });
  return lines;
}

function callsTable(calls: readonly CallRecord[]): string[] {
  if (calls.length === 0) return ['_No requests made. 未發出請求。_'];
  const lines = ['| # | Call 呼叫 | HTTP | Time 時間 | Size 大小 | Rate-limit headers 流量標頭 |', '| --- | --- | --- | --- | --- | --- |'];
  calls.forEach((call, i) => {
    const headers = Object.entries(call.rateLimitHeaders).map(([name, value]) => `${name}: ${value}`);
    const status = call.status === null ? `— (${call.error ?? 'no response'})` : `${call.status}${call.ok ? '' : ` ${call.error ?? ''}`}`;
    lines.push(`| ${[String(i + 1), call.label, status, `${call.ms} ms`, formatBytes(call.bytes), headers.join('; ') || '—'].map(cell).join(' | ')} |`);
  });
  lines.push('', 'Request URLs (keys blanked) 請求網址（金鑰已遮蔽）:', '');
  calls.forEach((call, i) => {
    const extras = [call.finalUrl ? `→ redirected to \`${call.finalUrl}\`` : '', call.lastModified ? `Last-Modified: ${call.lastModified}` : '']
      .filter(Boolean)
      .join(' · ');
    lines.push(`${i + 1}. \`${call.url}\`${extras ? ` (${extras})` : ''}`);
  });
  return lines;
}

function sourceSection(source: SourceResult, index: number): string[] {
  const lines = [
    `### ${index + 1}. ${source.name}: ${STATUS_LABEL[source.status]}`,
    '',
    `- Data 資料: ${source.row}`,
    `- Used by 使用功能: ${source.usedBy}`,
    `- Auth 驗證: ${source.auth}`,
    `- Documented limit 官方限制: ${source.documentedLimit}`,
    `- Checked 檢查時間: ${source.checkedAt}`,
    '',
    ...callsTable(source.calls),
  ];
  if (source.observedLimits.length > 0) lines.push('', 'Observed limits 實測限制:', '', ...source.observedLimits.map((text) => `- ${text}`));
  if (source.notes.length > 0) lines.push('', 'Notes 備註:', '', ...source.notes.map((text) => `- ${text}`));
  if (source.skipped.length > 0) lines.push('', 'Skipped 略過:', '', ...source.skipped.map((text) => `- ${text}`));
  for (const preview of source.previews) {
    lines.push('', `Sample 樣本: ${preview.label}`, '', `\`\`\`${preview.lang}`, preview.text.replace(/```/g, "'''"), '```');
  }
  return [...lines, ''];
}

export function renderReport(report: RunReport, tickers: readonly TickerSpec[] = TICKERS): string {
  const coverageSources = report.sources.filter((source) => source.coverageMarkets !== undefined);
  const principles = tickers.filter((ticker) => ticker.group === 'principles');
  const supporting = tickers.filter((ticker) => ticker.group === 'supporting');
  const keys = Object.entries(report.keys)
    .map(([name, present]) => `\`${name}\` ${present ? '✅' : '❌'}`)
    .join(' · ');
  const totalCalls = report.sources.reduce((sum, source) => sum + source.calls.length, 0);
  const okCalls = report.sources.reduce((sum, source) => sum + source.calls.filter((call) => call.ok).length, 0);
  const details = coverageDetails(coverageSources, tickers);

  return [
    '# Data source check 資料來源檢查',
    '',
    'PRD Phase 1, step 1: each PRD Section 6 source called once, with its limits, a sample payload and ticker coverage. ' +
      '第一階段第 1 步：每個資料來源呼叫一次，記錄流量限制、樣本與標的覆蓋。',
    '',
    `- Generated 產生時間: ${report.generatedAt} (Asia/Taipei)`,
    `- Runner 執行環境: ${report.runner} · Node ${report.node}`,
    `- Requests 請求: ${okCalls} of ${totalCalls} succeeded 成功`,
    `- Keys present 已設定的金鑰 (values never written 不寫出內容): ${keys}`,
    '',
    LEGEND,
    '',
    '## Summary 摘要',
    '',
    ...summaryTable(report.sources),
    '',
    '## Ticker coverage 標的覆蓋',
    '',
    '### Investment Principles tickers 投資原則標的',
    '',
    ...coverageTable(coverageSources, principles),
    '',
    `${UNLISTED_NOTE}`,
    '',
    '### Proxies and examples the models need 模型需要的代理指標與範例',
    '',
    ...coverageTable(coverageSources, supporting),
    '',
    SATELLITE_NOTE,
    '',
    ...(details.length > 0 ? ['### Coverage details 覆蓋細節', '', ...details, ''] : []),
    '## AGGU price source AGGU 價格來源',
    '',
    ...agguVerdict(report.sources),
    '',
    '## Market-level series 市場層級資料',
    '',
    ...seriesTable(report.sources),
    '',
    '## Source details 各來源細節',
    '',
    ...report.sources.flatMap(sourceSection),
    '---',
    '',
    'Raw payloads are saved under `reports/source-check/samples/` (git-ignored). Re-run one source with ' +
      '`npm run check:sources -- --only=<id>`; sources not re-run keep their last result. ' +
      '原始資料存在 `reports/source-check/samples/`（不會上傳）。',
    '',
  ].join('\n');
}
