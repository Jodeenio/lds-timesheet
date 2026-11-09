(() => {
  const panel = document.querySelector('#authPanel');
  const sheet = document.querySelector('#timesheet');
  const account = document.querySelector('#staffAccount');
  const form = document.querySelector('#loginForm');
  const email = document.querySelector('#staffLoginEmail');
  const password = document.querySelector('#staffPassword');
  const message = document.querySelector('#authMessage');
  const login = document.querySelector('#loginButton');
  const link = document.querySelector('#emailLink');
  const signOut = document.querySelector('#signOut');
  const accountToggle = document.querySelector('#accountToggle');
  const config = window.LDS_SUPABASE;
  const dashboardPage = document.body.dataset.page === 'dashboard';
  const staffUrl = new URL('index.html', document.baseURI);
  const dashboardUrl = new URL('dashboard/', document.baseURI);
  let client;
  let sessionCheck = 0;

  function closeAccountMenu() {
    account.dataset.open = 'false';
    accountToggle.setAttribute('aria-expanded', 'false');
  }

  accountToggle.addEventListener('click', () => {
    const open = accountToggle.getAttribute('aria-expanded') !== 'true';
    account.dataset.open = String(open);
    accountToggle.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', event => {
    if (!account.contains(event.target)) closeAccountMenu();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && account.dataset.open === 'true') {
      closeAccountMenu();
      accountToggle.focus();
    }
  });
  account.addEventListener('focusout', event => {
    if (!account.contains(event.relatedTarget)) closeAccountMenu();
  });
  window.matchMedia('(max-width: 600px)').addEventListener('change', closeAccountMenu);

  function busy(value) {
    login.disabled = link.disabled = value;
    form.setAttribute('aria-busy', String(value));
  }

  function showSession(session) {
    const user = session?.user || null;
    // Removing a submitted login form lets password managers detect success.
    // Keep its field values intact until the next signed-out state.
    if (user) {
      form.remove();
    } else if (!form.isConnected) {
      password.value = '';
      panel.insertBefore(form, message);
    }
    document.title = user ? 'LDS Staff · Timesheet' : 'LDS Staff · Sign in';
    panel.hidden = !!user;
    sheet.hidden = !user;
    account.hidden = !user;
    if (user && dashboardPage) document.title = 'LDS Staff | Admin dashboard';
    closeAccountMenu();
    document.querySelector('#staffEmail').textContent = user?.email || '';
    document.dispatchEvent(new CustomEvent('staff-session', { detail: user }));
    if (dashboardPage) {
      document.dispatchEvent(new CustomEvent('admin-session', { detail: user ? { user, client } : null }));
    }
  }

  async function resolveSession(session) {
    const check = ++sessionCheck;
    sheet.hidden = true;
    account.hidden = true;
    if (!session) {
      if (dashboardPage) {
        location.replace(staffUrl.href);
        return;
      }
      showSession(null);
      message.textContent = 'Sign in to access your timesheet.';
      return;
    }
    try {
      // Fetch the current server-controlled role, rather than trusting local metadata.
      const { data, error } = await client.auth.getUser(session.access_token);
      if (check !== sessionCheck) return;
      if (error || !data.user) throw error || new Error('No user');
      const admin = data.user.app_metadata?.role === 'admin';
      if (!admin && data.user.invited_at && !data.user.user_metadata?.onboarding_complete) {
        location.replace(new URL('welcome/', document.baseURI).href);
        return;
      }
      if (admin !== dashboardPage) {
        location.replace(admin ? dashboardUrl.href : staffUrl.href);
        return;
      }
      showSession({ user: data.user });
    } catch {
      if (check !== sessionCheck) return;
      showSession(null);
      message.textContent = 'Could not verify your account. Check your connection and sign in again.';
    }
  }

  if (!config?.url || !config?.publishableKey) {
    message.textContent = 'Staff sign in is not configured yet. Contact your LDS administrator.';
    return;
  }
  if (!window.supabase) {
    message.textContent = 'Could not load sign in. Check your connection and reload this page.';
    return;
  }

  try {
    client = window.supabase.createClient(config.url, config.publishableKey);
  } catch {
    message.textContent = 'Staff sign in configuration is invalid. Contact your LDS administrator.';
    return;
  }

  client.auth.onAuthStateChange((event, session) => {
    // Run Auth API requests after the auth event callback releases its lock.
    setTimeout(() => { void resolveSession(session); }, 0);
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    busy(true);
    message.textContent = 'Signing in...';
    try {
      const { error } = await client.auth.signInWithPassword({ email: email.value.trim(), password: password.value });
      message.textContent = error ? 'Unable to sign in. Check your email and password and try again.' : '';
    } catch {
      message.textContent = 'Could not reach sign in. Check your connection and try again.';
    } finally {
      busy(false);
    }
  });

  link.addEventListener('click', async () => {
    if (!email.reportValidity()) return;
    busy(true);
    message.textContent = 'Requesting a sign-in link...';
    try {
      const { error } = await client.auth.signInWithOtp({
        email: email.value.trim(),
        options: { shouldCreateUser: false, emailRedirectTo: location.origin + location.pathname }
      });
      message.textContent = error
        ? 'Could not send a sign-in link. Try again later or contact your administrator.'
        : 'If your staff account is enabled, check your email for a sign-in link.';
    } catch {
      message.textContent = 'Could not reach sign in. Check your connection and try again.';
    } finally {
      busy(false);
    }
  });

  signOut.addEventListener('click', async () => {
    signOut.disabled = true;
    try {
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (error) throw error;
      await resolveSession(null);
      message.textContent = 'You have signed out.';
      email.focus();
    } catch {
      document.querySelector('#weekMessage').textContent = 'Could not sign out. Please try again.';
    } finally {
      signOut.disabled = false;
    }
  });

  client.auth.getSession().then(({ data, error }) => {
    if (error) throw error;
    void resolveSession(data.session);
    message.textContent = 'Sign in to access your timesheet.';
    busy(false);
  }).catch(() => {
    showSession(null);
    message.textContent = 'Could not restore your session. Please sign in again.';
    busy(false);
  });
})();
