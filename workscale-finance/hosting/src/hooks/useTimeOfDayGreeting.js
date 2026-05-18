// useTimeOfDayGreeting — returns { greeting, firstName } based on Asia/Manila time
// firstName is resolved from Firestore appUsers (fullName field) so it shows
// the real person's name, not the Google account / company name.
import { useState, useEffect } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { auth, db } from '../firebase.js';

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
  const [firstName, setFirstName] = useState(() =>
    firstNameFrom(auth.currentUser?.displayName)
  );

  useEffect(() => {
    const email = auth.currentUser?.email;
    if (!email) return;

    getDocs(query(collection(db, 'appUsers'), where('email', '==', email)))
      .then(snap => {
        const data = snap.docs[0]?.data();
        // Prefer fullName, then displayName, then fall back to auth displayName
        const name = data?.fullName || data?.displayName || auth.currentUser?.displayName || '';
        setFirstName(firstNameFrom(name));
      })
      .catch(() => {});
  }, []);

  return { greeting: getManilaGreeting(), firstName };
}
