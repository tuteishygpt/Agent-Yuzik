import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const indexHtml = readFileSync(path.join(root, 'index.html'), 'utf8');
const mainJs = readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
const supabaseJs = readFileSync(path.join(root, 'src', 'supabase.js'), 'utf8');

assert.match(indexHtml, /id="btn-upgrade"[^>]*>Увайсці<\/button>/);
assert.match(indexHtml, /id="btn-sign-out"[^>]*>Выйсці<\/button>/);
assert.match(indexHtml, /id="btn-google-auth"[\s\S]*?Увайсці праз Google[\s\S]*?<\/button>/);
assert.match(mainJs, /btnGoogleAuth:\s*document\.getElementById\('btn-google-auth'\)/);
assert.match(mainJs, /btnSignOut:\s*document\.getElementById\('btn-sign-out'\)/);
assert.match(mainJs, /function getAuthDisplayName\(user\)/);
assert.match(mainJs, /email\.split\('@'\)\[0\]/);
assert.match(mainJs, /elements\.authBadge\.textContent\s*=\s*getAuthDisplayName\(user\)/);
assert.match(mainJs, /handleSignOutClick/);
assert.match(mainJs, /signInWithGoogle\(\)/);
assert.match(supabaseJs, /export async function signInWithGoogle\(\)/);
assert.match(supabaseJs, /export async function signOutUser\(\)/);
assert.match(supabaseJs, /supabase\.auth\.signOut\(\)/);
assert.match(supabaseJs, /supabase\.auth\.signInWithOAuth\(\s*\{\s*provider:\s*'google'/s);
assert.doesNotMatch(supabaseJs, /linkIdentity\(\s*\{\s*provider:\s*'google'/s);
