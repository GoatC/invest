import { redirect } from 'next/navigation';

/** The securities now sit folded at the foot of the holdings page; `saved` opens them with its message. */
export default async function SecuritiesPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const { saved } = await searchParams;
  redirect(`/holdings${saved ? `?securities=${encodeURIComponent(saved)}` : ''}#securities`);
}
