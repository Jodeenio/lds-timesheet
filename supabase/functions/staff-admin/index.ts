import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async (req: Request) => {
  const appUrl = Deno.env.get('APP_URL');
  const headers = {
    'Access-Control-Allow-Origin': appUrl ? new URL(appUrl).origin : '',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Vary': 'Origin',
  };
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return reply(405, { error: 'Method not allowed.' });
  if (!appUrl) return reply(503, { error: 'Staff invitations are not configured. Set APP_URL on the staff-admin function.' });
  const authorization = req.headers.get('Authorization') || '';
  if (!authorization.startsWith('Bearer ')) return reply(401, { error: 'Sign in to continue.' });

  try {
    // This key stays on the server. Verify the caller before any admin operation.
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error } = await admin.auth.getUser(authorization.slice(7));
    if (error || !user) return reply(401, { error: 'Your session has expired. Sign in again.' });
    if (user.app_metadata?.role !== 'admin') return reply(403, { error: 'Administrator access required.' });

    let body;
    try { body = await req.json(); } catch { return reply(400, { error: 'Invalid request.' }); }
    if (!body || typeof body !== 'object') return reply(400, { error: 'Invalid request.' });
    if (body.action === 'list') {
      const page = body.page ?? 1;
      if (!Number.isSafeInteger(page) || page < 1 || page > 10000) return reply(400, { error: 'Invalid page.' });
      const { data, error: listError } = await admin.auth.admin.listUsers({ page, perPage: 50 });
      if (listError) return reply(502, { error: 'Could not load staff. Try again.' });
      return reply(200, {
        users: data.users.map(staff => ({
          id: staff.id,
          email: staff.email || '',
          name: staff.user_metadata?.full_name || '',
          role: staff.app_metadata?.role === 'admin' ? 'Admin' : 'Staff',
          status: staff.user_metadata?.onboarding_complete ? 'Active' : staff.invited_at && !staff.last_sign_in_at ? 'Invited' : 'Setup pending',
        })),
        hasMore: page * 50 < data.total,
      });
    }
    if (body.action === 'invite') {
      const firstName = typeof body.firstName === 'string' ? body.firstName.trim() : '';
      const lastName = typeof body.lastName === 'string' ? body.lastName.trim() : '';
      if (!firstName || !lastName || firstName.length > 60 || lastName.length > 60) {
        return reply(400, { error: 'Enter a first and last name of up to 60 characters each.' });
      }
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply(400, { error: 'Enter a valid staff email address.' });
      const redirectTo = new URL('welcome/', appUrl.endsWith('/') ? appUrl : `${appUrl}/`).href;
      const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo,
        data: { full_name: `${firstName} ${lastName}` },
      });
      if (inviteError) return reply(400, { error: 'Could not send invitation. The account may already exist, or email delivery may be unavailable. Check Supabase Auth logs.' });
      return reply(200, { invited: true });
    }
    return reply(400, { error: 'Unknown staff action.' });
  } catch {
    return reply(500, { error: 'Staff management is unavailable. Check the function configuration and logs.' });
  }
});
