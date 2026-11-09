(() => {
  const $ = selector => document.querySelector(selector);
  const dialog = $('#inviteDialog');
  let client = null, page = 1, request = 0, loading = false, removing = false;
  const settings = $('#staffSettings');
  let selected = null, settingsRequest = 0, settingsBusy = false, ratesLoaded = false;

  function selectTab(rates) {
    $('#generalPanel').hidden = rates;
    $('#ratesPanel').hidden = !rates;
    for (const [id, active] of [['generalTab', !rates], ['ratesTab', rates]]) {
      $(`#${id}`).setAttribute('aria-selected', String(active));
      $(`#${id}`).tabIndex = active ? 0 : -1;
    }
    if (rates && !ratesLoaded) void loadRates();
  }
  $('#generalTab').onclick = () => selectTab(false);
  $('#ratesTab').onclick = () => selectTab(true);
  document.querySelector('.settings-tabs').addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const rates = event.key === 'End' || (event.key !== 'Home' && event.target.id === 'generalTab');
    selectTab(rates);
    $(rates ? '#ratesTab' : '#generalTab').focus();
  });
  $('#closeSettings').onclick = () => { if (!settingsBusy) settings.close(); };
  settings.addEventListener('cancel', event => { if (settingsBusy) event.preventDefault(); });
  settings.addEventListener('close', () => { selected = null; ++settingsRequest; });

  async function openSettings(staff) {
    selected = staff;
    const current = ++settingsRequest;
    ratesLoaded = false;
    $('#generalForm').reset();
    $('#ratesForm').reset();
    selectTab(false);
    $('#settingsTitle').textContent = staff.name || staff.email;
    $('#settingsFields').disabled = true;
    $('#settingsMessage').textContent = 'Loading employee details...';
    settings.showModal();
    try {
      const data = await call({ action: 'details', userId: staff.id });
      if (current !== settingsRequest) return;
      selected = { ...staff, ...data };
      for (const key of ['FirstName', 'LastName', 'Email', 'Phone']) {
        $(`#edit${key}`).value = data[key[0].toLowerCase() + key.slice(1)] || '';
      }
      $('#removeStaff').hidden = !data.removable;
      $('#settingsFields').disabled = false;
      $('#settingsMessage').textContent = '';
    } catch (error) {
      if (current === settingsRequest) $('#settingsMessage').textContent = error.message;
    }
  }
  async function loadRates() {
    if (!selected || settingsBusy) return;
    const current = settingsRequest;
    $('#ratesForm').querySelector('button').disabled = true;
    $('#settingsMessage').textContent = 'Loading rates...';
    try {
      const data = await call({ action: 'rates', userId: selected.id });
      if (current !== settingsRequest) return;
      document.querySelectorAll('[data-rate]').forEach(input => { input.value = data.rates[input.dataset.rate] ?? ''; });
      ratesLoaded = true;
      $('#ratesForm').querySelector('button').disabled = false;
      $('#settingsMessage').textContent = '';
    } catch (error) {
      if (current === settingsRequest) $('#settingsMessage').textContent = error.message + ' Reopen the Rates tab to retry.';
    }
  }
  async function saveSettings(body, success, after) {
    if (!selected || settingsBusy) return;
    const current = settingsRequest;
    settingsBusy = true;
    $('#settingsFields').disabled = true;
    $('#closeSettings').disabled = true;
    $('#settingsMessage').textContent = 'Please wait...';
    try {
      await call({ ...body, userId: selected.id });
      if (current !== settingsRequest) return;
      $('#settingsMessage').textContent = success;
      if (after) await after();
    } catch (error) {
      if (current === settingsRequest) $('#settingsMessage').textContent = error.message;
    } finally {
      settingsBusy = false;
      $('#settingsFields').disabled = false;
      $('#closeSettings').disabled = false;
    }
  }
  $('#generalForm').onsubmit = event => {
    event.preventDefault();
    void saveSettings({ action: 'update', firstName: $('#editFirstName').value.trim(), lastName: $('#editLastName').value.trim(),
      email: $('#editEmail').value.trim(), phone: $('#editPhone').value.trim() }, 'General details saved.', async () => {
      selected.email = $('#editEmail').value.trim();
      selected.name = `${$('#editFirstName').value.trim()} ${$('#editLastName').value.trim()}`;
      $('#settingsTitle').textContent = selected.name;
      await loadStaff();
    });
  };
  $('#ratesForm').onsubmit = event => {
    event.preventDefault();
    if (!ratesLoaded) return;
    const rates = {};
    document.querySelectorAll('[data-rate]').forEach(input => { rates[input.dataset.rate] = input.value === '' ? null : Number(input.value); });
    void saveSettings({ action: 'save-rates', rates }, 'Rates saved.');
  };
  $('#resetStaffPassword').onclick = () => {
    if (selected && window.confirm(`Send a password reset email to ${selected.email}?`)) {
      void saveSettings({ action: 'reset-password' }, `Password reset email sent to ${selected.email}.`);
    }
  };
  $('#removeStaff').onclick = () => {
    if (!selected || !window.confirm(`Permanently remove ${selected.name || selected.email} (${selected.email})? This cannot be undone. Browser-saved timesheets remain on their device.`)) return;
    void saveSettings({ action: 'remove' }, 'Employee removed.', async () => {
      settings.close();
      page = 1;
      await loadStaff();
    });
  };

  async function call(body) {
    const { data, error } = await client.functions.invoke('staff-admin', { body });
    if (error) {
      let detail;
      try { detail = await error.context?.json(); } catch {}
      throw new Error(detail?.error || 'Could not reach staff management. Check that the staff-admin function is deployed and try again.');
    }
    return data;
  }

  async function loadStaff() {
    if (!client || removing) return;
    const current = ++request;
    loading = true;
    $('#staffPrevious').disabled = $('#staffNext').disabled = $('#staffRefresh').disabled = true;
    $('#staffMessage').textContent = 'Loading staff...';
    $('#staffRows').replaceChildren();
    try {
      const data = await call({ action: 'list', page });
      if (current !== request) return;
      for (const staff of data.users) {
        const row = document.createElement('tr');
        for (const value of [staff.name || 'Not provided', staff.email, staff.role, staff.status]) {
          const cell = document.createElement('td');
          cell.textContent = value;
          row.append(cell);
        }
        const actions = document.createElement('td');
        const settingsButton = document.createElement('button');
        settingsButton.type = 'button';
        settingsButton.className = 'outline staff-more';
        settingsButton.textContent = '\u22ee';
        settingsButton.setAttribute('aria-label', `Settings for ${staff.name || staff.email}`);
        settingsButton.setAttribute('aria-haspopup', 'dialog');
        settingsButton.addEventListener('click', () => { void openSettings(staff); });
        actions.append(settingsButton);
        row.append(actions);
        $('#staffRows').append(row);
      }
      $('#staffMessage').textContent = data.users.length ? '' : 'No staff accounts found.';
      $('#staffPage').textContent = `Page ${page}`;
      $('#staffPrevious').disabled = page <= 1;
      $('#staffNext').disabled = !data.hasMore;
    } catch (error) {
      if (current === request) $('#staffMessage').textContent = error.message;
    } finally {
      if (current === request) {
        loading = false;
        $('#staffRefresh').disabled = false;
      }
    }
  }

  document.addEventListener('admin-session', event => {
    client = event.detail?.client || null;
    if (client) { void loadStaff(); return; }
    ++request;
    ++settingsRequest;
    selected = null;
    settings.close();
    $('#staffRows').replaceChildren();
    dialog.close();
  });
  $('#staffPrevious').onclick = () => { if (!loading && !removing && page > 1) { page--; void loadStaff(); } };
  $('#staffNext').onclick = () => { if (!loading && !removing) { page++; void loadStaff(); } };
  $('#staffRefresh').onclick = () => { void loadStaff(); };
  $('#addStaff').onclick = () => {
    $('#inviteForm').reset();
    $('#inviteMessage').textContent = '';
    dialog.showModal();
  };
  $('#cancelInvite').onclick = () => dialog.close();
  $('#inviteForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (!client) return;
    const email = $('#inviteEmail').value.trim();
    const firstName = $('#inviteFirstName').value.trim();
    const lastName = $('#inviteLastName').value.trim();
    if (!firstName || !lastName) {
      $('#inviteMessage').textContent = 'Enter the staff member\'s first and last name.';
      $(!firstName ? '#inviteFirstName' : '#inviteLastName').focus();
      return;
    }
    $('#sendInvite').disabled = true;
    $('#inviteMessage').textContent = 'Sending invitation...';
    try {
      await call({ action: 'invite', email, firstName, lastName });
      $('#inviteMessage').textContent = `Invitation sent to ${email}. They can follow the email link to finish setting up their account.`;
      $('#inviteForm').reset();
      page = 1;
      await loadStaff();
    } catch (error) {
      $('#inviteMessage').textContent = error.message;
    } finally {
      $('#sendInvite').disabled = false;
    }
  });
})();
