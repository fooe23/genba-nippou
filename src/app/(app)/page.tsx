import { requireProfile } from '@/lib/db/profile';

export default async function HomePage() {
  const profile = await requireProfile();
  return (
    <main className="p-4">
      <h1 className="text-xl font-bold">ようこそ、{profile.name || profile.email} さん</h1>
    </main>
  );
}
