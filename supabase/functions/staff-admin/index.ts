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
    if (['details', 'update', 'rates', 'save-rates', 'reset-password'].includes(body.action)) {
      const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
      if (!/^[0-9a-f-]{36}$/i.test(userId)) return reply(400, { error: 'Select a valid staff account.' });
      const { data: target, error: targetError } = await admin.auth.admin.getUserById(userId);
      if (targetError || !target.user) return reply(404, { error: 'Staff account not found.' });
      const staff = target.user;
      if (body.action === 'details') {
        const metadata = staff.user_metadata || {};
        const parts = (metadata.full_name || '').trim().split(/\s+/);
        return reply(200, { id: staff.id, firstName: metadata.first_name ?? parts.shift() ?? '',
          lastName: metadata.last_name ?? parts.join(' '), email: staff.email || '', phone: metadata.phone || '',
          removable: staff.id !== user.id && staff.app_metadata?.role !== 'admin' });
      }
      if (body.action === 'update') {
        const firstName = typeof body.firstName === 'string' ? body.firstName.trim() : '';
        const lastName = typeof body.lastName === 'string' ? body.lastName.trim() : '';
        const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
        const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
        if (!firstName || !lastName || firstName.length > 60 || lastName.length > 60 || phone.length > 40 ||
          email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply(400, { error: 'Enter valid names, email and phone (up to 40 characters).' });
        const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
          email, user_metadata: { ...staff.user_metadata, first_name: firstName, last_name: lastName,
            full_name: `${firstName} ${lastName}`, phone },
        });
        if (updateError) return reply(400, { error: 'Could not save details. Check whether the email is already in use.' });
        return reply(200, { saved: true });
      }
      if (body.action === 'reset-password') {
        if (!staff.email) return reply(400, { error: 'This account has no email address.' });
        const redirectTo = new URL('welcome/?mode=reset', appUrl.endsWith('/') ? appUrl : `${appUrl}/`).href;
        const { error: resetError } = await admin.auth.resetPasswordForEmail(staff.email, { redirectTo });
        if (resetError) return reply(502, { error: 'Could not send reset email. Try again later.' });
        return reply(200, { sent: true });
      }
      if (body.action === 'rates') {
        const { data, error: ratesError } = await admin.from('staff_rates').select('regular,overtime,public_holiday,public_holiday_overtime').eq('user_id', userId).maybeSingle();
        if (ratesError) return reply(502, { error: 'Could not load rates. Check that the staff_rates migration has been applied.' });
        return reply(200, { rates: data || {} });
      }
      const rates: Record<string, number | null> = {};
      for (const key of ['regular', 'overtime', 'public_holiday', 'public_holiday_overtime']) {
        const value = body.rates?.[key];
        if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 99999999.99 || Math.abs(value * 100 - Math.round(value * 100)) > 0.00001)) {
          return reply(400, { error: 'Enter non-negative rates with at most two decimal places, or leave blank.' });
        }
        rates[key] = value;
      }
      const { error: ratesError } = await admin.from('staff_rates').upsert({ user_id: userId, ...rates, updated_at: new Date().toISOString() });
      if (ratesError) return reply(502, { error: 'Could not save rates. Check that the staff_rates migration has been applied.' });
      return reply(200, { saved: true });
    }
    if (body.action === 'remove') {
      const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
        return reply(400, { error: 'Select a valid staff account.' });
      }
      if (userId === user.id) return reply(403, { error: 'You cannot remove your own account.' });
      const { data: target, error: targetError } = await admin.auth.admin.getUserById(userId);
      if (targetError || !target.user) return reply(404, { error: 'Staff account could not be found. Refresh the list and try again.' });
      if (target.user.app_metadata?.role === 'admin') return reply(403, { error: 'Administrator accounts cannot be removed from the staff dashboard.' });
      const { error: removeError } = await admin.auth.admin.deleteUser(userId);
      if (removeError) return reply(502, { error: 'Could not remove staff. Try again or check Supabase Auth logs.' });
      return reply(200, { removed: true });
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
        data: { first_name: firstName, last_name: lastName, full_name: `${firstName} ${lastName}` },
      });
      if (inviteError) return reply(400, { error: 'Could not send invitation. The account may already exist, or email delivery may be unavailable. Check Supabase Auth logs.' });
      return reply(200, { invited: true });
    }
    return reply(400, { error: 'Unknown staff action.' });
  } catch {
    return reply(500, { error: 'Staff management is unavailable. Check the function configuration and logs.' });
  }
});
