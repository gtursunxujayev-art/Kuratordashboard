import { redirect } from 'next/navigation';

export default function IntensivPage() {
  redirect('/dashboard?category=intensiv');
}

