import { currentUser } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { getContactsByUserId } from '@/lib/db';
import ContactList from '@/components/ContactList';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { SignInButton, UserButton } from '@clerk/nextjs';

export default async function HomePage() {
  const user = await currentUser();

  // If not logged in, show a landing page instead of redirecting
  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-slate-800 mb-4">Location Contacts</h1>
          <p className="text-slate-600 mb-8">Remember where you met everyone</p>
          <SignInButton mode="modal">
            <button className="bg-blue-500 hover:bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold">
              Sign In to Get Started
            </button>
          </SignInButton>
        </div>
      </div>
    );
  }

  const contacts = await getContactsByUserId(user.id);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20 shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-xl font-bold text-slate-800">My Contacts</h1>
          <div className="flex items-center gap-3">
            <Link
              href="/contacts/new"
              className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-semibold transition-colors"
            >
              <Plus className="w-4 h-4" />
              New
            </Link>
            <UserButton />
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-4">
        <ContactList contacts={contacts} />
      </main>
    </div>
  );
}
