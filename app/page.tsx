import { redirect } from 'next/navigation';

/** The weekly dashboard becomes the home page in Phase 1, step 10; until then home is the holdings page. */
export default function Home() {
  redirect('/holdings');
}
