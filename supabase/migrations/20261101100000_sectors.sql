-- Phase 2, step 7 (N7): the sector tab: heatmap, treemap and bubble chart.
--
-- sectors (config): the colour convention (Taiwan's red up, green down by default; or green up),
--   the Select Sector SPDR fund that prices each US GICS sector, and the TWSE industry indices that
--   price Taiwan's, each by FinMind's id with TWSE's own name (the fallback feed's) and its GICS
--   sector. The aggregate indices (電子類 holds the electronics sub-indices) stand for their parts,
--   so no company is counted twice. The nightly job loads each proxy's daily closes into
--   index_prices (Phase 2, step 2's table): a fund under its ticker, an index as TW_<FinMind id>.

insert into public.config (key, value, desc_en, desc_zh) values
  ('sectors', '{
     "colour": "red_up",
     "us": {
       "XLK": "Information Technology", "XLF": "Financials", "XLV": "Health Care", "XLY": "Consumer Discretionary",
       "XLC": "Communication Services", "XLI": "Industrials", "XLP": "Consumer Staples", "XLE": "Energy",
       "XLB": "Materials", "XLU": "Utilities", "XLRE": "Real Estate"
     },
     "tw": {
       "Electronic": {"name": "電子工業類指數", "sector": "Information Technology"},
       "FinancialInsurance": {"name": "金融保險類指數", "sector": "Financials"},
       "BiotechnologyMedicalCare": {"name": "生技醫療類指數", "sector": "Health Care"},
       "Automobile": {"name": "汽車類指數", "sector": "Consumer Discretionary"},
       "Textiles": {"name": "紡織纖維類指數", "sector": "Consumer Discretionary"},
       "Tourism": {"name": "觀光餐旅類指數", "sector": "Consumer Discretionary"},
       "TradingConsumersGoods": {"name": "貿易百貨類指數", "sector": "Consumer Discretionary"},
       "Rubber": {"name": "橡膠類指數", "sector": "Consumer Discretionary"},
       "Food": {"name": "食品類指數", "sector": "Consumer Staples"},
       "Cement": {"name": "水泥類指數", "sector": "Materials"},
       "Plastics": {"name": "塑膠類指數", "sector": "Materials"},
       "Chemical": {"name": "化學類指數", "sector": "Materials"},
       "IronSteel": {"name": "鋼鐵類指數", "sector": "Materials"},
       "PaperPulp": {"name": "造紙類指數", "sector": "Materials"},
       "GlassCeramic": {"name": "玻璃陶瓷類指數", "sector": "Materials"},
       "ElectricMachinery": {"name": "電機機械類指數", "sector": "Industrials"},
       "ElectricalCable": {"name": "電器電纜類指數", "sector": "Industrials"},
       "ShippingTransportation": {"name": "航運類指數", "sector": "Industrials"},
       "BuildingMaterialConstruction": {"name": "建材營造類指數", "sector": "Real Estate"},
       "OilGasElectricity": {"name": "油電燃氣類指數", "sector": "Utilities"}
     },
     "last_verified": null
   }',
   'Sector tab (N7): the colour convention (red_up: Taiwan''s red up, green down; green_up: the US''s), the Select Sector SPDR fund of each US GICS sector, and the TWSE industry indices of Taiwan''s, each by FinMind id with its TWSE name and GICS sector.',
   '產業熱圖（N7）：配色慣例（red_up：台灣紅漲綠跌；green_up：美國綠漲），美國各 GICS 產業對應的 Select Sector SPDR 基金，以及台灣各產業對應的證交所類股指數（FinMind 代號、證交所名稱與 GICS 產業）。');
