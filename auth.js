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
  const alternateSignIn = document.querySelector('#alternateSignIn');
  const choices = document.querySelector('#signInChoices');
  const otpPanel = document.querySelector('#emailOtpPanel');
  const otpRequestForm = document.querySelector('#otpRequestForm');
  const otpVerifyForm = document.querySelector('#otpVerifyForm');
  const otpEmail = document.querySelector('#otpEmail');
  const otpCode = document.querySelector('#otpCode');
  const resendOtp = document.querySelector('#resendOtp');
  const passkeyDialog = document.querySelector('#passkeyDialog');
  const passkeyMessage = document.querySelector('#passkeyMessage');
  let otpAddress = '', resendAfter = 0, resendTimer, signingIn = false, creatingPasskey = false;
  const signOut = document.querySelector('#signOut');
  const accountToggle = document.querySelector('#accountToggle');
  const config = window.LDS_SUPABASE;
  const dashboardPage = document.body.dataset.page === 'dashboard';
  const accountPage = document.body.dataset.page === 'account';
  const editingTimesheet = !dashboardPage && !accountPage && new URLSearchParams(location.search).has('editTimesheet');
  const staffUrl = new URL('index.html', document.baseURI);
  const dashboardUrl = new URL('dashboard/', document.baseURI);
  let client;
  let sessionCheck = 0;
  let displayedIdentity;
  let displayedUserId = null;

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
    signingIn = value;
    login.disabled = link.disabled = value;
    alternateSignIn.querySelectorAll('button').forEach(button => { button.disabled = value; });
    otpEmail.disabled = otpCode.disabled = value;
    updateResend();
    form.setAttribute('aria-busy', String(value));
  }

  function updateResend() {
    clearTimeout(resendTimer);
    const seconds = Math.max(0, Math.ceil((resendAfter - Date.now()) / 1000));
    resendOtp.disabled = signingIn || seconds > 0;
    resendOtp.textContent = seconds ? `Resend code (${seconds}s)` : 'Resend code';
    if (seconds) resendTimer = setTimeout(updateResend, 1000);
  }

  function showSignInView(view) {
    form.hidden = view !== 'password';
    alternateSignIn.hidden = view === 'password';
    choices.hidden = view === 'otp';
    otpPanel.hidden = view !== 'otp';
    message.textContent = '';
    if (view === 'otp') {
      otpEmail.value = email.value.trim();
      otpRequestForm.hidden = false;
      otpVerifyForm.hidden = true;
      otpCode.value = '';
      otpAddress = '';
      otpEmail.focus();
    } else if (view === 'password') email.focus();
    else document.querySelector('#emailOtpOption').focus();
  }

  function showSession(session) {
    const user = session?.user || null;
    const identity = user ? JSON.stringify([user.id, user.app_metadata?.role, user.email, user.user_metadata]) : 'signed-out';
    // Focus and token refresh events can repeat without changing the account.
    // Keep the current week, expanded rows, dialogs, and unsaved edits intact.
    if (identity === displayedIdentity) return;
    displayedIdentity = identity;
    displayedUserId = user?.id || null;
    // Removing a submitted login form lets password managers detect success.
    // Keep its field values intact until the next signed-out state.
    if (user) {
      form.remove();
    } else if (!form.isConnected) {
      password.value = '';
      panel.insertBefore(form, message);
    }
    if (!user) {
      showSignInView('password');
      passkeyDialog?.close();
      otpAddress = '';
      otpCode.value = '';
      clearTimeout(resendTimer);
    }
    document.title = user ? 'LDS Staff · Timesheet' : 'LDS Staff · Sign in';
    panel.hidden = !!user;
    sheet.hidden = !user;
    account.hidden = !user;
    if (user && dashboardPage) document.title = 'LDS Staff | Admin dashboard';
    if (user && accountPage) {
      document.title = 'LDS Staff | Account settings';
      const back = document.querySelector('#accountBack');
      const manager = ['admin', 'owner'].includes(user.app_metadata?.role);
      back.href = manager ? dashboardUrl.href : staffUrl.href;
      back.textContent = manager ? 'Back to dashboard' : 'Back to timesheet';
    }
    closeAccountMenu();
    const staffName = user ? (user.user_metadata?.full_name?.trim() || 'Staff') : '';
    document.querySelectorAll('[data-staff-name]').forEach(element => {
      element.textContent = staffName;
      element.title = staffName;
    });
    document.querySelector('#staffEmail').textContent = user?.email || '';
    document.dispatchEvent(new CustomEvent('staff-session', { detail: user }));
    if (!dashboardPage && !accountPage) document.dispatchEvent(new CustomEvent('staff-client', { detail: user ? { user, client } : null }));
    if (dashboardPage) {
      document.dispatchEvent(new CustomEvent('admin-session', { detail: user ? { user, client } : null }));
    }
  }

  async function resolveSession(session) {
    const check = ++sessionCheck;
    if (!session || session.user?.id !== displayedUserId) {
      sheet.hidden = true;
      account.hidden = true;
    }
    if (!session) {
      if (dashboardPage || accountPage) {
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
      if (error) throw error;
      if (!data.user) throw Object.assign(new Error('No user'), { status: 401 });
      const admin = ['admin', 'owner'].includes(data.user.app_metadata?.role);
      if (!admin && data.user.invited_at && !data.user.user_metadata?.onboarding_complete) {
        location.replace(new URL('welcome/', document.baseURI).href);
        return;
      }
      if (!accountPage && admin !== dashboardPage && !(admin && editingTimesheet)) {
        location.replace(admin ? dashboardUrl.href : staffUrl.href);
        return;
      }
      if (editingTimesheet && !admin) {
        location.replace(staffUrl.href);
        return;
      }
      showSession({ user: data.user });
    } catch (error) {
      if (check !== sessionCheck) return;
      // A temporary network failure on return should not discard an open page.
      // Expired/revoked sessions still clear the workspace.
      if (displayedUserId && session.user?.id === displayedUserId && (!error.status || error.status >= 500)) return;
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
    client = window.supabase.createClient(config.url, config.publishableKey, {
      auth: { experimental: { passkey: true } },
    });
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

  link.addEventListener('click', () => showSignInView('options'));
  document.querySelector('#emailOtpOption').onclick = () => showSignInView('otp');
  document.querySelector('#passwordSignIn').onclick = () => showSignInView('password');
  document.querySelector('#backSignInOptions').onclick = () => showSignInView('options');
  document.querySelector('#changeOtpEmail').onclick = () => showSignInView('otp');

  async function sendOtp(address) {
    if (signingIn || Date.now() < resendAfter) return;
    busy(true);
    message.textContent = 'Sending sign-in code...';
    try {
      const { error } = await client.auth.signInWithOtp({
        email: address,
        options: { shouldCreateUser: false }
      });
      if (error) {
        message.textContent = 'Could not send a code. Please wait a minute and try again, or contact your administrator.';
        return;
      }
      otpAddress = address;
      resendAfter = Date.now() + 60000;
      otpCode.value = '';
      otpRequestForm.hidden = true;
      otpVerifyForm.hidden = false;
      document.querySelector('#otpSentTo').textContent = `Enter the code emailed to ${address}.`;
      message.textContent = 'If your staff account is enabled, a sign-in code has been sent. Check your inbox and spam folder.';
    } catch {
      message.textContent = 'Could not reach sign in. Check your connection and try again.';
    } finally {
      busy(false);
      if (!otpVerifyForm.hidden) otpCode.focus();
    }
  }
  otpRequestForm.onsubmit = event => {
    event.preventDefault();
    if (!otpEmail.reportValidity()) return;
    if (Date.now() < resendAfter) {
      message.textContent = 'Please wait a minute before requesting another code.';
      return;
    }
    void sendOtp(otpEmail.value.trim());
  };
  resendOtp.onclick = () => { if (otpAddress) void sendOtp(otpAddress); };
  otpVerifyForm.onsubmit = async event => {
    event.preventDefault();
    if (signingIn || !otpAddress || !otpCode.reportValidity()) return;
    const token = otpCode.value.trim();
    busy(true);
    message.textContent = 'Verifying sign-in code...';
    try {
      const { error } = await client.auth.verifyOtp({ email: otpAddress, token, type: 'email' });
      message.textContent = error ? 'That code is invalid or expired. Try again or request a new code.' : '';
    } catch {
      message.textContent = 'Could not verify the code. Check your connection and try again.';
    } finally { busy(false); }
  };

  const passkeysSupported = () => window.isSecureContext && !!window.PublicKeyCredential && !!navigator.credentials;
  document.querySelector('#passkeySignIn').onclick = async () => {
    if (signingIn) return;
    if (!passkeysSupported() || typeof client.auth.signInWithPasskey !== 'function') {
      message.textContent = 'Passkeys are unavailable in this browser. Use email OTP or your password instead.';
      return;
    }
    busy(true);
    message.textContent = 'Choose your saved passkey to sign in...';
    try {
      const { error } = await client.auth.signInWithPasskey();
      message.textContent = error ? 'Passkey sign-in was not completed. Try again or use another sign-in option.' : '';
    } catch {
      message.textContent = 'Passkey sign-in was not completed. Try again or use another sign-in option.';
    } finally { busy(false); }
  };

  if (passkeyDialog) {
    document.querySelector('#setupPasskey').onclick = () => {
      closeAccountMenu();
      passkeyMessage.textContent = '';
      passkeyDialog.showModal();
    };
    document.querySelector('#closePasskeyDialog').onclick = () => { if (!creatingPasskey) passkeyDialog.close(); };
    passkeyDialog.addEventListener('cancel', event => { if (creatingPasskey) event.preventDefault(); });
    document.querySelector('#createPasskey').onclick = async () => {
      if (creatingPasskey || !displayedUserId) return;
      if (!passkeysSupported() || typeof client.auth.registerPasskey !== 'function') {
        passkeyMessage.textContent = 'Passkeys are unavailable in this browser. Open the site over HTTPS in a supported browser.';
        return;
      }
      const userId = displayedUserId;
      creatingPasskey = true;
      passkeyDialog.querySelectorAll('button').forEach(button => { button.disabled = true; });
      signOut.disabled = true;
      passkeyMessage.textContent = 'Follow your device’s instructions to create a passkey...';
      try {
        const { error } = await client.auth.registerPasskey();
        if (userId !== displayedUserId) return;
        passkeyMessage.textContent = error ? 'Could not create a passkey. Try again or contact your administrator.' : 'Passkey saved. You can now choose Sign in with passkey next time.';
      } catch {
        if (userId === displayedUserId) passkeyMessage.textContent = 'Passkey setup was not completed. Please try again.';
      } finally {
        creatingPasskey = false;
        passkeyDialog.querySelectorAll('button').forEach(button => { button.disabled = false; });
        signOut.disabled = false;
      }
    };
  }

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
