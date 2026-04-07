import { redirect } from 'next/navigation';

export default function OnlinePage() {
  redirect('/dashboard?category=online');
}

