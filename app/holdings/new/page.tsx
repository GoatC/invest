import { redirect } from 'next/navigation';

type Params = Record<string, string | string[] | undefined>;

/** New trades are entered at the top of the holdings page; a link here keeps what it fills in. */
export default async function NewTradePage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, item);
  }
  const text = query.toString();
  redirect(`/holdings${text ? `?${text}` : ''}#add-trade`);
}
