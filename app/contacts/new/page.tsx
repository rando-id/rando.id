import { currentUser } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import ContactForm from '@/components/ContactForm';

export default async function NewContactPage() {
  const user = await currentUser();
	console.log({ user })

  if (!user) {
    redirect('/sign-in');
  }

  return <ContactForm />;
}
