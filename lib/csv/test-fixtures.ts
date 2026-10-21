/**
 * Invented demo statements for the CSV tests (CLAUDE.md: demo data only). They copy the layouts
 * brokers use, not anyone's trades.
 */

/** A Taiwanese 複委託 export: title lines above the header, a settlement-date column, a totals row. */
export const TW_STATEMENT = [
  '複委託交易明細（示範）,,,,,,,,,,,',
  '帳號：示範帳戶,,,,,,,,,,,',
  '成交日期,交割日期,市場,股票代號,股票名稱,買賣別,成交股數,成交價格,成交金額,手續費,其他費用,幣別',
  '2026/10/07,2026/10/09,美國,VT,Vanguard Total World,買進,2,150.00,300.00,1.00,0.00,USD',
  '2026/10/08,2026/10/10,美國,AAPL,Apple,賣出,1,236.00,236.00,1.00,0.02,USD',
  ',,,,,,,,,,,',
  ',,,,,,,,合計,2.00,0.02,',
].join('\r\n');

/** A US-broker export: quoted cells, dollar signs, month-first dates, sells as negative quantities. */
export const US_STATEMENT = [
  '"Trade Date","Transaction ID","Symbol","Action","Quantity","Price","Commission","Fees","Amount","Description"',
  '"10/07/2026","T-1001","VT","Buy","2","$150.00","$1.00","$0.00","-$301.00","VANGUARD TOTAL WORLD"',
  '"10/08/2026","T-1002","AAPL","Sell","-1","$236.00","$1.00","$0.02","$234.98","APPLE INC, COMMON"',
  '"10/09/2026","T-1003","VT","Dividend","","","","","$1.24","DIVIDEND"',
].join('\n');

/** A Taiwan-stock export with ROC (民國) dates and ="00692" cells that keep the leading zeros. */
export const ROC_STATEMENT = ['成交日期,股票代號,買賣別,成交股數,成交價格,手續費,交易稅', '115/10/07,="00692",現股買進,100,88.00,20,0', '115/10/15,="00692",現股賣出,20,92.00,20,1.84'].join('\n');
