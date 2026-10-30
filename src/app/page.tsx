import { APP_NAME } from '@/lib/constants';

export default function Home() {
  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold">{APP_NAME}</h1>
    </main>
  );
}
