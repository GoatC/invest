import Link from 'next/link';

import { Bi } from '@/components/bi';

export default function NotFound() {
  return (
    <section className="card narrow form">
      <p>
        <Bi en="This page or entry does not exist." zh="找不到這個頁面或資料。" />
      </p>
      <p>
        <Link href="/holdings">
          <Bi en="Back to holdings" zh="回到持倉" />
        </Link>
      </p>
    </section>
  );
}
