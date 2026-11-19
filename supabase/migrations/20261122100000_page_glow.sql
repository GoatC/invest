-- The Ink (甲) design's tab headline washes (docs/design-handoff/02-components.md): Holdings glows in the tone of its
-- last session at a fixed 0.45, Performance in the tone of its difference against the benchmark at a fixed 0.5.
-- Allocation has none (its headline has no direction). The strengths sit in config glow, beside the poster's, so none
-- is written in code (lib/models/glow.ts pageGlowOf).
update public.config
set value = value || '{"page_k": {"holdings": 0.45, "performance": 0.5}}'::jsonb
where key = 'glow' and not (value ? 'page_k');

update public.config
set desc_en = desc_en || ' page_k: the fixed strength of each tab headline''s smaller wash (holdings, performance).',
    desc_zh = desc_zh || ' page_k：各分頁標題區較小光暈的固定強度（持倉、績效）。'
where key = 'glow' and desc_en not like '%page_k%';
