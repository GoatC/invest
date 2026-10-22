-- Phase 1, step 11 (F15): fee and tax drag, and the US estate-tax check. Four config rows, all
-- edited on the Costs page and logged in the audit log like every setting; none is personal.
--
-- tax: the thresholds and rates that change with the law (PRD Section 9: "stored as config with a
--   'last verified' date"), checked 2026-10-22 against public sources:
--   - withholding on distributions by fund domicile: a US-domiciled fund pays a Taiwan resident with
--     30% withheld (no US–Taiwan tax agreement in force yet: the bill that would lower it to 15%
--     still waits for the US Senate); an Irish fund has about 15% withheld on US dividends inside
--     the fund; a Taiwan fund none.
--   - Taiwan securities transaction tax on a sale: 0.3% on shares, 0.1% on ETFs; bond ETFs exempt
--     (through 2026-12-31 under the current law).
--   - 所得基本稅額 (minimum tax): a household's overseas income counts in full once it reaches
--     NT$1,000,000 a year; tax is 20% of the basic income above the NT$7,500,000 exemption.
--   - 二代健保 supplementary premium: 2.11% of a single dividend payment of NT$20,000 or more, up to
--     NT$10,000,000 a payment.
--   - US estate tax on a non-resident's US assets above the exemption runs from 18% to 40% (the
--     US$60,000 exemption itself is the rule US_ESTATE_TAX's threshold).
-- fees: the 複委託 broker the fee estimates use (null until chosen on the Costs page), the Taiwan
--   commission (0.1425% × the broker's discount, at least min_twd an order), and the TWD-to-dollar
--   FX spread assumed when a broker has none entered (0.1% of the amount).
-- brokers: 複委託 brokers to compare, in USD per order: shares, ETFs (null: as shares), the monthly
--   DCA plan, London orders, whether London-listed (Irish) ETFs are offered, custody, FX spread.
--   Starting values from a public comparison dated 2026-09-27; checked is null until the owner
--   checks them against each broker's own page. London prices are not public: null until asked.
-- fund_costs: the core vehicles and their Irish-domiciled alternatives: TER, the yield withholding
--   applies to (an accumulating fund's index yield), the share of it withheld when it differs from
--   the domicile's, tracking difference. Starting values from the issuers' pages and press, to be
--   checked; yields move with markets.
insert into public.config (key, value, desc_en, desc_zh, last_verified) values
  ('tax',
   '{"withholding": {"US": 0.30, "IE": 0.15, "TW": 0},
     "tw_transaction_tax": {"stock": 0.003, "etf": 0.001, "bond_etf": 0},
     "amt": {"overseas_floor_twd": 1000000, "exemption_twd": 7500000, "rate": 0.20},
     "nhi": {"rate": 0.0211, "single_payment_twd": 20000, "max_payment_twd": 10000000},
     "us_estate": {"min_rate": 0.18, "max_rate": 0.40}}',
   'Tax thresholds and rates (F15): withholding by fund domicile, Taiwan transaction tax, the minimum tax''s overseas-income floor, exemption and rate, the supplementary health premium on dividends, US estate-tax rates. last_verified is when they were last checked.',
   '稅務門檻與稅率（F15）：依基金註冊地的股息預扣稅、台股證交稅、最低稅負制的海外所得門檻、免稅額與稅率、股利的二代健保補充保費、美國遺產稅稅率。last_verified 為最後確認日期。',
   '2026-10-22'),
  ('fees',
   '{"broker": null, "tw": {"rate": 0.001425, "discount": 1, "min_twd": 20}, "fx_spread": 0.001}',
   'Fee estimates (F15): the 複委託 broker used (an id from brokers; null until chosen), the Taiwan commission (rate × discount, at least min_twd an order) and the FX spread assumed when a broker has none.',
   '費用估算（F15）：使用的複委託券商（brokers 中的 id；選定前為 null）、台股手續費（費率 × 折扣，每筆至少 min_twd）、券商未填時假設的換匯價差。',
   null),
  ('brokers',
   '[{"id": "cathay", "name_en": "Cathay Securities", "name_zh": "國泰證券",
      "us_stock": {"rate": 0.0008}, "us_etf": {"flat": 3}, "us_dca": {"flat": 0.1}, "uk": null, "lse_etfs": null,
      "custody_rate": 0, "fx_spread": null, "promo_until": "2026-12-31",
      "note_en": "Electronic orders: shares 0.08% with no minimum, ETFs US$3 an order; DCA US$0.1 an order (from US$10).",
      "note_zh": "電子下單：個股 0.08% 無低消，ETF 每筆 3 美元；定期定額每筆 0.1 美元（10 美元起）。",
      "source": "https://stevenhongisme.com/securities_firms/sub-brokerage-intro/", "checked": null},
     {"id": "sinopac", "name_en": "SinoPac Securities", "name_zh": "永豐金證券",
      "us_stock": {"rate": 0.0008}, "us_etf": null, "us_dca": {"flat": 0.01}, "uk": null, "lse_etfs": null,
      "custody_rate": 0, "fx_spread": null, "promo_until": "2026-12-31",
      "note_en": "0.08% with no minimum up to US$50,000 a month, the listed 0.5%–1% beyond; DCA US$0.01 an order paid in dollars (US$0.03 in TWD).",
      "note_zh": "單月 5 萬美元內 0.08% 無低消，超過依牌告 0.5%–1%；定期定額以美元扣款每筆 0.01 美元（台幣扣款 0.03 美元）。",
      "source": "https://stevenhongisme.com/securities_firms/sub-brokerage-intro/", "checked": null},
     {"id": "yuanta", "name_en": "Yuanta Securities", "name_zh": "元大證券",
      "us_stock": {"rate": 0.001, "min": 1}, "us_etf": null, "us_dca": {"rate": 0.001, "max": 1}, "uk": null, "lse_etfs": null,
      "custody_rate": 0, "fx_spread": null, "promo_until": null,
      "note_en": "0.1%, at least US$1 an order; DCA 0.1%, at most US$1 an order.",
      "note_zh": "0.1%，每筆至少 1 美元；定期定額 0.1%，每筆最多 1 美元。",
      "source": "https://stevenhongisme.com/securities_firms/sub-brokerage-intro/", "checked": null},
     {"id": "masterlink", "name_en": "MasterLink Securities", "name_zh": "元富證券",
      "us_stock": {"rate": 0.005, "min": 35}, "us_etf": null, "us_dca": {"rate": 0.0015}, "uk": null, "lse_etfs": null,
      "custody_rate": 0, "fx_spread": null, "promo_until": null,
      "note_en": "The listed rate: 0.5%, at least US$35 an order (lower on request through a sales agent); DCA 0.15%. Shows what a minimum fee does to small orders.",
      "note_zh": "牌告費率：0.5%，每筆至少 35 美元（可洽營業員調整）；定期定額 0.15%。可看出低消對小額下單的影響。",
      "source": "https://stevenhongisme.com/securities_firms/sub-brokerage-intro/", "checked": null}]',
   '複委託 brokers compared (F15), fees in USD an order: shares, ETFs, DCA, London; London ETFs offered, custody, FX spread, promotion end, source and when checked.',
   '比較的複委託券商（F15），每筆費用以美元計：個股、ETF、定期定額、英股；是否提供倫敦掛牌 ETF、保管費、換匯價差、優惠截止日、來源與確認日期。',
   null),
  ('fund_costs',
   '[{"ticker": "VT", "name": "Vanguard Total World Stock ETF", "asset_class_id": "us_global_equity", "domicile": "US", "market": "US", "distribution": "dist",
      "ter": 0.0006, "yield": 0.018, "withholding": null, "tracking_difference": null,
      "note_en": "", "note_zh": "", "source": "https://investor.vanguard.com/investment-products/etfs/profile/vt", "checked": null},
     {"ticker": "VOO", "name": "Vanguard S&P 500 ETF", "asset_class_id": "us_global_equity", "domicile": "US", "market": "US", "distribution": "dist",
      "ter": 0.0003, "yield": 0.012, "withholding": null, "tracking_difference": null,
      "note_en": "", "note_zh": "", "source": "https://investor.vanguard.com/investment-products/etfs/profile/voo", "checked": null},
     {"ticker": "VWRA", "name": "Vanguard FTSE All-World UCITS ETF (USD) Accumulating", "asset_class_id": "us_global_equity", "domicile": "IE", "market": "UK", "distribution": "acc",
      "ter": 0.0019, "yield": 0.018, "withholding": 0.09, "tracking_difference": null,
      "note_en": "About 15% is withheld inside the fund on US dividends, some 60% of its yield.", "note_zh": "基金內對美股股息預扣約 15%，美股約占其股息的六成。",
      "source": "Vanguard UK fund page (VWRA)", "checked": null},
     {"ticker": "CSPX", "name": "iShares Core S&P 500 UCITS ETF (Acc)", "asset_class_id": "us_global_equity", "domicile": "IE", "market": "UK", "distribution": "acc",
      "ter": 0.0007, "yield": 0.012, "withholding": null, "tracking_difference": null,
      "note_en": "", "note_zh": "", "source": "iShares UK fund page (CSPX)", "checked": null},
     {"ticker": "0050", "name": "元大台灣50", "asset_class_id": "tw_market_cap", "domicile": "TW", "market": "TW", "distribution": "dist",
      "ter": 0.001155, "yield": null, "withholding": null, "tracking_difference": null,
      "note_en": "Management 0.0855% and custody 0.03% at its size; the management fee steps down as the fund grows.", "note_zh": "依目前規模經理費 0.0855%、保管費 0.03%；經理費隨規模遞減。",
      "source": "https://wantrich.chinatimes.com/news/20260314900007-420401", "checked": null},
     {"ticker": "00692", "name": "富邦公司治理", "asset_class_id": "tw_market_cap", "domicile": "TW", "market": "TW", "distribution": "dist",
      "ter": 0.00185, "yield": null, "withholding": null, "tracking_difference": null,
      "note_en": "Management 0.15% and custody 0.035%.", "note_zh": "經理費 0.15%、保管費 0.035%。",
      "source": "https://wantrich.chinatimes.com/news/20260314900007-420401", "checked": null},
     {"ticker": "00922", "name": "國泰台灣領袖50", "asset_class_id": "tw_market_cap", "domicile": "TW", "market": "TW", "distribution": "dist",
      "ter": 0.00219, "yield": null, "withholding": null, "tracking_difference": null,
      "note_en": "Management and custody together about 0.219%; the management fee steps down as the fund grows.", "note_zh": "經理費加保管費約 0.219%；經理費隨規模遞減。",
      "source": "https://wantrich.chinatimes.com/news/20260314900007-420401", "checked": null},
     {"ticker": "009816", "name": "凱基台灣TOP50", "asset_class_id": "tw_market_cap", "domicile": "TW", "market": "TW", "distribution": "acc",
      "ter": 0.00097, "yield": null, "withholding": null, "tracking_difference": null,
      "note_en": "Management 0.07% and custody 0.027%; pays no dividends, so no supplementary premium; trading costs rise in the months it changes holdings.", "note_zh": "經理費 0.07%、保管費 0.027%；不配息，因此沒有補充保費；換股月份的交易成本較高。",
      "source": "https://wantrich.chinatimes.com/news/20260314900007-420401", "checked": null},
     {"ticker": "BNDW", "name": "Vanguard Total World Bond ETF", "asset_class_id": "global_bonds", "domicile": "US", "market": "US", "distribution": "dist",
      "ter": 0.0005, "yield": 0.036, "withholding": null, "tracking_difference": null,
      "note_en": "Much of its payout can be interest-related dividends that are not withheld, if the broker applies it; 30% is assumed.", "note_zh": "部分配息屬利息相關股利，券商若適用可免預扣；此處假設預扣 30%。",
      "source": "https://investor.vanguard.com/investment-products/etfs/profile/bndw", "checked": null},
     {"ticker": "AGGU", "name": "iShares Core Global Aggregate Bond UCITS ETF (USD Hedged, Acc)", "asset_class_id": "global_bonds", "domicile": "IE", "market": "UK", "distribution": "acc",
      "ter": 0.001, "yield": 0.035, "withholding": 0, "tracking_difference": null,
      "note_en": "Bond interest is mostly paid to an Irish fund without withholding.", "note_zh": "債券利息支付給愛爾蘭基金時大多不預扣。",
      "source": "https://www.ishares.com/uk/individual/en/products/291772/ishares-core-global-aggregate-bond-ucits-etf", "checked": null},
     {"ticker": "GLDM", "name": "SPDR Gold MiniShares Trust", "asset_class_id": "real_assets", "domicile": "US", "market": "US", "distribution": "dist",
      "ter": 0.001, "yield": 0, "withholding": null, "tracking_difference": null,
      "note_en": "Pays nothing out; a US trust, so it counts as a US asset for estate tax.", "note_zh": "不配息；為美國信託，遺產稅上視為美國資產。",
      "source": "https://www.ssga.com/us/en/intermediary/etfs/spdr-gold-minishares-trust-gldm", "checked": null},
     {"ticker": "IGLN", "name": "iShares Physical Gold ETC", "asset_class_id": "real_assets", "domicile": "IE", "market": "UK", "distribution": "acc",
      "ter": 0.0012, "yield": 0, "withholding": null, "tracking_difference": null,
      "note_en": "An exchange-traded commodity issued in Ireland, backed by gold.", "note_zh": "愛爾蘭發行、以實體黃金擔保的 ETC。",
      "source": "iShares UK fund page (IGLN)", "checked": null},
     {"ticker": "BIL", "name": "SPDR Bloomberg 1-3 Month T-Bill ETF", "asset_class_id": "strategic_cash", "domicile": "US", "market": "US", "distribution": "dist",
      "ter": 0.001356, "yield": 0.038, "withholding": null, "tracking_difference": null,
      "note_en": "Its payout is mostly interest-related dividends that are not withheld, if the broker applies it; 30% is assumed.", "note_zh": "配息大多屬利息相關股利，券商若適用可免預扣；此處假設預扣 30%。",
      "source": "https://www.ssga.com/us/en/intermediary/etfs/spdr-bloomberg-1-3-month-t-bill-etf-bil", "checked": null},
     {"ticker": "IB01", "name": "iShares $ Treasury Bond 0-1yr UCITS ETF (Acc)", "asset_class_id": "strategic_cash", "domicile": "IE", "market": "UK", "distribution": "acc",
      "ter": 0.0007, "yield": 0.038, "withholding": 0, "tracking_difference": null,
      "note_en": "US Treasury interest is paid to an Irish fund without withholding.", "note_zh": "美國公債利息支付給愛爾蘭基金時不預扣。",
      "source": "iShares UK fund page (IB01)", "checked": null}]',
   'Fund costs (F15): the core vehicles and their Irish-domiciled alternatives: TER, the yield withholding applies to, the share withheld when it differs from the domicile''s, tracking difference, source and when checked.',
   '基金成本（F15）：核心工具與愛爾蘭註冊的替代選擇：總費用率、預扣稅適用的殖利率、與註冊地不同時的預扣比例、追蹤差異、來源與確認日期。',
   null);

-- US_ESTATE_TAX is evaluated from this step on: every US-domiciled holding, both pools, against the
-- exemption. It proposes no orders (a sale abroad is overseas income, and the swap is a choice for
-- the owner), so it fires at most once a month while the state holds, not every week.
update public.rules
set desc_en = 'US estate tax: US-situs assets (US shares and US-domiciled ETFs, both pools) above US$60,000, the exemption a non-US resident''s estate has; suggest Irish-domiciled equivalents.',
    desc_zh = '美國遺產稅：美國資產（美股與美國註冊 ETF，兩個資金池合計）超過 6 萬美元（非美國居民的遺產免稅額）時，建議改用愛爾蘭註冊的同類 ETF。',
    cooldown_days = 30
where id = 'US_ESTATE_TAX';
