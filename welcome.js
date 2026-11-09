(() => {
  const $ = selector => document.querySelector(selector);
  const message = $('#welcomeMessage');
  const form = $('#welcomeForm');
  const submit = $('#completeSetup');
  const config = window.LDS_SUPABASE;
  const resetting = new URLSearchParams(location.search).get('mode') === 'reset';
  if (resetting) {
    document.title = 'LDS Staff | Reset password';
    $('#welcomeTitle').textContent = 'Reset your password';
    $('#welcomeDescription').textContent = 'Choose a new password for your staff account.';
    submit.textContent = 'Save password and continue';
  }
  if (!window.supabase || !config?.url || !config?.publishableKey) {
    message.textContent = 'Account setup is unavailable. Contact your LDS administrator.';
    return;
  }
  const client = window.supabase.createClient(config.url, config.publishableKey);
  let check = 0, saving = false;
  async function load(session) {
    if (saving) return;
    const current = ++check;
    form.hidden = true;
    if (!session) {
      message.textContent = 'Open the invitation link from your email to set up your account. If it has expired, ask your administrator for help.';
      return;
    }
    try {
      const { data: { user }, error } = await client.auth.getUser(session.access_token);
      if (current !== check || saving) return;
      if (error || !user) throw error;
      $('#welcomeEmail').value = user.email || '';
      if (!$('#phone').value) $('#phone').value = user.user_metadata?.phone || '';
      form.hidden = false;
      message.textContent = '';
    } catch {
      if (current === check) message.textContent = 'Could not verify your invitation. Reopen your invitation email or sign in and try again.';
    }
  }
  client.auth.onAuthStateChange((event, session) => {
    setTimeout(() => { void load(session); }, 0);
  });
  client.auth.getSession().then(({ data, error }) => {
    if (error) throw error;
    return load(data.session);
  }).catch(() => { message.textContent = 'Could not load your invitation. Reload and try again.'; });

  $('#confirmPassword').addEventListener('input', () => $('#confirmPassword').setCustomValidity(''));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if ($('#newPassword').value !== $('#confirmPassword').value) {
      $('#confirmPassword').setCustomValidity('Passwords must match.');
      $('#confirmPassword').reportValidity();
      return;
    }
    saving = true;
    ++check;
    submit.disabled = true;
    message.textContent = 'Saving your details...';
    try {
      const { data, error } = await client.auth.updateUser({
        password: $('#newPassword').value,
        data: { phone: $('#phone').value.trim(), onboarding_complete: true }
      });
      if (error) {
        message.textContent = error.message;
        return;
      }
      form.remove();
      location.replace(new URL(data.user.app_metadata?.role === 'admin' ? 'dashboard/' : 'index.html', document.baseURI).href);
    } catch {
      message.textContent = 'Could not save your details. Check your connection and try again.';
    } finally {
      saving = false;
      submit.disabled = false;
    }
  });
})();
