// useTimeOfDayGreeting — returns { greeting, firstName } based on Asia/Manila time.
// firstName comes from the signed-in session (user.fullName, falling back to
// the email prefix) so it shows the real person's name.
import { useAuth } from '../auth/AuthProvider.jsx';

function getManilaGreeting() {
  const manilaHour = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' })
  ).getHours();
  if (manilaHour < 12) return 'Good morning';
  if (manilaHour < 18) return 'Good afternoon';
  return 'Good evening';
}

function firstNameFrom(fullName) {
  return (fullName || '').trim().split(/\s+/)[0] || 'there';
}

export function useTimeOfDayGreeting() {
  const { session } = useAuth();
  const email = session?.user?.email || '';
  const name = session?.user?.fullName || (email ? email.split('@')[0] : '');
  return { greeting: getManilaGreeting(), firstName: firstNameFrom(name) };
}
