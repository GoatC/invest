import { redirect } from 'next/navigation';

type Params = Record<string, string | string[] | undefined>;

/** The proposals now sit at the foot of the dashboard; an old link keeps what it asked for. */
export default async function ProposalsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, item);
  }
  const text = query.toString();
  redirect(`/${text ? `?${text}` : ''}#proposals`);
}
