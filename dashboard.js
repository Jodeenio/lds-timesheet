(() => {
  const $ = selector => document.querySelector(selector);
  const dialog = $('#inviteDialog');
  let client = null, page = 1, request = 0, loading = false;

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
    if (!client) return;
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
    $('#staffRows').replaceChildren();
    dialog.close();
  });
  $('#staffPrevious').onclick = () => { if (!loading && page > 1) { page--; void loadStaff(); } };
  $('#staffNext').onclick = () => { if (!loading) { page++; void loadStaff(); } };
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
    $('#sendInvite').disabled = true;
    $('#inviteMessage').textContent = 'Sending invitation...';
    try {
      await call({ action: 'invite', email });
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
