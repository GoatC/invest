import { redirect } from 'next/navigation';

/** The Value at Risk page now lives on the dashboard, its details folded under the figure. */
export default function RiskPage() {
  redirect('/#value-at-risk');
}
