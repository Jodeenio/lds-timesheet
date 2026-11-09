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
  let client;

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
    document.title = user ? 'LDS Staff · Timesheet' : 'LDS Staff · Sign in';
    panel.hidden = !!user;
    sheet.hidden = !user;
    account.hidden = !user;
    closeAccountMenu();
    document.querySelector('#staffEmail').textContent = user?.email || '';
    password.value = '';
    document.dispatchEvent(new CustomEvent('staff-session', { detail: user }));
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
    showSession(session);
    if (!session) message.textContent = 'Sign in to access your timesheet.';
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
      showSession(null);
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
    showSession(data.session);
    message.textContent = 'Sign in to access your timesheet.';
    busy(false);
  }).catch(() => {
    showSession(null);
    message.textContent = 'Could not restore your session. Please sign in again.';
    busy(false);
  });
})();
