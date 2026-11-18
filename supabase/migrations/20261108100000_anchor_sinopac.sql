-- The costs page now prices orders with SinoPac (永豐金證券) unless the owner picks another broker.
-- fees.broker names the broker the fee estimates use (an id from the brokers row); it was null
-- until chosen on the Costs page.
update public.config
set value = jsonb_set(value, '{broker}', '"sinopac"')
where key = 'fees';
