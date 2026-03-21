import { getSupabaseSession } from './supabase.js';

const statusElement = document.getElementById('auth-status');
const detailElement = document.getElementById('auth-detail');

function setStatus(status, detail = '') {
  if (statusElement) {
    statusElement.textContent = status;
  }

  if (detailElement) {
    detailElement.textContent = detail;
  }
}

async function finishAuthCallback() {
  try {
    setStatus('Completing sign in', 'Finalizing your Supabase session...');

    const deadline = Date.now() + 2000;
    let session = await getSupabaseSession();
    while (!session && Date.now() < deadline) {
      await new Promise((resolve) => window.setTimeout(resolve, 100));
      session = await getSupabaseSession();
    }

    if (!session) {
      setStatus('Returning to the app', 'Your anonymous session will be created on the next page.');
    }

    window.setTimeout(() => {
      window.location.replace('/');
    }, 300);
  } catch (error) {
    console.error('Auth callback failed:', error);
    setStatus('Sign in finished with a warning', 'Returning to the app...');
    window.setTimeout(() => {
      window.location.replace('/');
    }, 900);
  }
}

void finishAuthCallback();
