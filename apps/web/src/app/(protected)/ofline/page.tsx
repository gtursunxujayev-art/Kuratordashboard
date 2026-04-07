import { redirect } from 'next/navigation';

export default function OflinePage() {
  redirect('/dashboard?category=offline');
}

