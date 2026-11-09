(() => {
const $ = s => document.querySelector(s),
  T = TempoTime;

let data = { days: {} };
let storageError = false;
let staffId = null;
let workTypes = [], workTypesReady = false, workTypesRequest = 0, staffClient = null;
let submission = null, submissionReady = false, submissionRequest = 0, submitting = false;
const locked = () => !submissionReady || submitting || ['pending', 'approved'].includes(submission?.status);
function submissionText() {
  if (submitting) return 'Submitting timesheet...';
  if (!submissionReady) return 'Loading submission status...';
  return submission?.status === 'approved' ? 'Approved. This week is locked.'
    : submission?.status === 'pending' ? 'Submitted — awaiting admin approval. This week is locked.'
    : submission?.status === 'denied' ? `Denied. ${submission.denial_reason || ''} Update your shifts and submit again.`
    : 'Draft — changes save on this device until you submit.';
}
async function submissionCall(body) {
  const { data: result, error } = await staffClient.functions.invoke('staff-admin', { body });
  if (error) {
    let detail;
    try { detail = await error.context?.json(); } catch {}
    throw new Error(detail?.error || 'Could not reach timesheet submissions. Try again.');
  }
  return result;
}
async function loadSubmission() {
  const current = ++submissionRequest, userId = staffId, weekKey = T.key(week);
  submission = null;
  submissionReady = false;
  $('#retrySubmission').hidden = true;
  render();
  if (!staffClient || !staffId) return;
  try {
    const result = await submissionCall({ action: 'my-timesheet', week: weekKey });
    if (current !== submissionRequest || userId !== staffId || weekKey !== T.key(week)) return;
    submission = result.timesheet;
    submissionReady = true;
    if (submission && (submission.status !== 'denied' || !days().some(d => data.days[T.key(d)]))) {
      for (const date of days()) delete data.days[T.key(date)];
      Object.assign(data.days, submission.days);
      persist();
    }
    render();
  } catch (error) {
    if (current !== submissionRequest || userId !== staffId) return;
    $('#submissionStatus').textContent = error.message;
    $('#retrySubmission').hidden = false;
  }
}
$('#retrySubmission').onclick = () => { void loadSubmission(); };
const defaultLabels = { regular: 'Regular', overtime: 'Overtime', 'public holiday': 'Public holiday', 'public holiday overtime': 'Public holiday overtime' };
const typeLabel = shift => shift.typeLabel || workTypes.find(type => type.key === shift.type)?.label || defaultLabels[shift.type] || shift.type;
function emptyShift() {
  const type = workTypes.find(type => !type.hidden);
  return { start: '', end: '', nextDay: false, type: type?.key || '', typeLabel: type?.label || '' };
}
function typeOptions(shift) {
  const hidden = workTypes.find(type => type.key === shift.type)?.hidden;
  if (hidden) return `<option value="${escape(shift.type)}" selected hidden disabled>${escape(typeLabel(shift))}</option>` + workTypes.filter(type => !type.hidden).map(type => `<option value="${escape(type.key)}">${escape(type.label)}</option>`).join('');
  const available = workTypes.some(type => type.key === shift.type);
  const retained = available ? '' : `<option value="${escape(shift.type)}" selected disabled>${escape(typeLabel(shift) || 'Select a work type')} (unavailable)</option>`;
  return retained + workTypes.filter(type => !type.hidden).map(type => `<option value="${escape(type.key)}" ${type.key === shift.type ? 'selected' : ''}>${escape(type.label)}</option>`).join('');
}
document.addEventListener('staff-client', event => {
  staffClient = event.detail?.client || null;
  void loadWorkTypes();
});
async function loadWorkTypes() {
  const current = ++workTypesRequest;
  const userId = staffId;
  workTypesReady = false;
  workTypes = [];
  $('#retryWorkTypes').hidden = true;
  $('#workTypesMessage').textContent = staffClient ? 'Loading your work types...' : '';
  render();
  if (!staffClient || !userId) return;
  try {
    const { data: result, error } = await staffClient.functions.invoke('staff-admin', { body: { action: 'my-work-types' } });
    if (current !== workTypesRequest || userId !== staffId) return;
    if (error || !Array.isArray(result?.types) || !result.types.length) throw error || new Error('No enabled work types');
    workTypes = result.types;
    workTypesReady = true;
    $('#workTypesMessage').textContent = '';
    render();
    void loadSubmission();
  } catch {
    if (current !== workTypesRequest) return;
    $('#workTypesMessage').textContent = 'Could not load your enabled work types. Retry or contact your administrator.';
    $('#retryWorkTypes').hidden = false;
  }
}
$('#retryWorkTypes').onclick = () => { void loadWorkTypes(); };
const storageKey = () => `lds-weekly-v1:${staffId}`;

document.addEventListener('staff-session', event => {
  const nextId = event.detail?.id || null;
  if (nextId === staffId) return;
  staffId = nextId;
  ++submissionRequest;
  submission = null;
  submissionReady = false;
  workTypesReady = false;
  workTypes = [];
  data = { days: {} };
  storageError = false;
  week = T.monday(new Date());
  if (staffId) {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey()));
      if (saved?.days && typeof saved.days === 'object' && !Array.isArray(saved.days)) data = saved;
    } catch {
      storageError = true;
    }
  }
  $('#saveStatus').textContent = storageError ? 'Could not load saved timesheet' : 'Saved on this device';
  render();
});

let week = T.monday(new Date());
const today = T.key(new Date());
const escape = s => String(s).replace(/[&<>"']/g, c => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[c]));

function days() {
  return Array.from({ length: 7 }, (_, i) => T.shift(week, i));
}

function persist() {
  if (!staffId) return false;
  try {
    localStorage.setItem(storageKey(), JSON.stringify(data));
    storageError = false;
    $('#saveStatus').textContent = 'Saved on this device';
    return true;
  } catch {
    storageError = true;
    $('#saveStatus').textContent = 'Could not save';
    $('#weekMessage').textContent = 'Your browser could not save these changes. Export this week to keep a copy.';
    return false;
  }
}

function getDay(k) {
  if (!data.days[k]) return { shifts: [emptyShift()] };
  return T.normalizeDay(data.days[k]);
}

function render() {
  let ds = days(), end = ds[6];

  $('#weekLabel').textContent = week.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: week.getFullYear() !== end.getFullYear() ? 'numeric' : undefined
  }) + ' – ' + end.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
  $('#weekPicker').value = T.key(week);
  $('#days').innerHTML = ds.map((d, i) => {
    let k = T.key(d), r = getDay(k);
    return `<section class="daycard ${i > 4 ? 'weekend' : ''}" data-date="${k}" aria-label="${k} shifts">` +
      `<div class="dayheading">` +
      `<div class="dayname">${d.toLocaleDateString(undefined, { weekday: 'long' })}${k === today ? '<span class="todaytag">TODAY</span>' : ''}<small>${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</small>` +
      `</div>` +
      `<div class="daytotals">` +
      `<small>Daily total</small>` +
      `<output class="daytotal" aria-label="${k} total">` +
      `</output>` +
      `</div>` +
      `</div>` +
      `<div class="shifts">${r.shifts.map((shift, j) =>
      `<div class="shiftrow" data-shift="${j}">` +
      `<span class="shiftlabel">Shift ${j + 1}</span>` +
      `<label class="worktype">Work type<select data-type aria-label="${k} shift ${j + 1} work type">` +
      typeOptions(shift) +
      `</select>` +
      `</label>` +
      `<div class="field">` +
      `<label for="start-${k}-${j}">Start time</label>` +
      `<input class="timeinput" type="time" id="start-${k}-${j}" data-field="start" value="${escape(shift.start)}" aria-label="${k} shift ${j + 1} start time" aria-describedby="error-${k}-${j}">` +
      `</div>` +
      `<div class="field">` +
      `<label for="end-${k}-${j}">End time</label>` +
      `<input class="timeinput" type="time" id="end-${k}-${j}" data-field="end" value="${escape(shift.end)}" aria-label="${k} shift ${j + 1} end time" aria-describedby="error-${k}-${j}">` +
      `</div>` +
      `<label class="overnight">` +
      `<input type="checkbox" data-field="nextDay" ${shift.nextDay ? 'checked' : ''} aria-label="${k} shift ${j + 1} ends next day">Ends next day</label>` +
      `<output class="shifttotal" aria-label="${k} shift ${j + 1} total">` +
      `</output>` +
      `<button class="clear" data-remove="${j}" aria-label="Remove ${k} shift ${j + 1}" title="Remove shift">×</button>` +
      `<div class="rowerror" id="error-${k}-${j}">` +
      `</div>` +
      `</div>`
    ).join('')}</div>` +
      `<button class="addshift" data-add>＋ Add shift</button>` +
      `</section>`;
  }).join('');

  $('#days').querySelectorAll('input, select, button').forEach(element => { element.disabled = !workTypesReady || locked(); });
  $('#submitWeek').disabled = !workTypesReady || locked();
  $('#submitWeek').textContent = submitting ? 'Submitting...' : 'Submit timesheet';
  $('#submissionStatus').textContent = submissionText();
  for (const id of ['previous', 'next', 'thisWeek', 'weekPicker']) $(`#${id}`).disabled = submitting;

  updateTotals();
  $('#weekMessage').textContent = storageError
    ? 'Browser storage is unavailable. Export your week to keep a copy.'
    : '';
}

function updateTotals() {
  let total = 0, count = 0, errors = 0;

  document.querySelectorAll('.daycard').forEach(row => {
    let result = T.dayTotal(getDay(row.dataset.date));
    row.querySelector('.daytotal').textContent = result.complete ? T.format(result.minutes) : '—';
    row.querySelectorAll('.shiftrow').forEach((shift, i) => {
      let r = result.shifts[i];
      shift.querySelector('.shifttotal').textContent = r.complete ? T.format(r.minutes) : '—';
      shift.querySelector('.rowerror').textContent = r.error;
      shift.querySelectorAll('.timeinput').forEach(input =>
        input.setAttribute('aria-invalid', r.error ? 'true' : 'false')
      );
    });
    total += result.minutes;
    count += result.complete ? 1 : 0;
    errors += result.errors;
  });

  $('#weeklyTotal').textContent = T.format(total);
  $('#daysCount').textContent = `${count} ${count === 1 ? 'day' : 'days'} entered${errors ? ' · ' + errors + ' incomplete shifts' : ''}`;
  return errors;
}

function handleEdit(e) {
  if (!workTypesReady || locked()) return;
  const field = e.target.dataset.field,
    isType = e.target.matches('[data-type]');
  if (!field && !isType) return;

  const k = e.target.closest('.daycard').dataset.date, r = getDay(k);
  let i = Number(e.target.closest('.shiftrow').dataset.shift);

  if (isType) {
    if (!workTypes.some(type => type.key === e.target.value && !type.hidden)) return;
    r.shifts[i].type = e.target.value;
    r.shifts[i].typeLabel = workTypes.find(type => type.key === e.target.value).label;
  } else {
    r.shifts[i][field] = field === 'nextDay' ? e.target.checked : e.target.value;
  }

  data.days[k] = r;
  persist();
  updateTotals();
  if (!storageError) $('#weekMessage').textContent = '';
}

$('#days').addEventListener('input', handleEdit);
$('#days').addEventListener('change', e => {
  if (!e.target.matches('[data-type], [data-field]')) return;
  if (!workTypesReady || locked()) return;
  handleEdit(e);
  const k = e.target.closest('.daycard').dataset.date;
  const i = Number(e.target.closest('.shiftrow').dataset.shift);
  const r = getDay(k);
  const overtimeType = T.overtimeType(r.shifts[i].type);
  if (!workTypes.some(type => type.key === overtimeType) || !workTypes.some(type => type.key === r.shifts[i].type)) return;
  const following = r.shifts[i + 1];
  const rebalanced = e.target.dataset.field === 'start'
    ? T.rebalanceOvertime(r.shifts[i], following) : null;
  const split = rebalanced || T.splitOvertime(r.shifts[i], following);
  if (!rebalanced && split.length === 1) return;
  const merged = !rebalanced && following?.type === split[1].type
    && following.start === r.shifts[i].end
    && T.duration(following).complete
    && T.duration(split[1]).minutes === T.duration(r.shifts[i]).minutes - 480 + T.duration(following).minutes;
  r.shifts.splice(i, rebalanced || merged ? 2 : 1, ...split);
  data.days[k] = r;
  persist();
  render();
  $('#weekMessage').textContent = storageError
    ? 'The shift was split, but could not be saved. Export your week to keep a copy.'
    : 'Shift updated. Hours after the first 8 are recorded as Overtime.';
});

$('#days').addEventListener('click', e => {
  const add = e.target.closest('[data-add]'),
    remove = e.target.closest('[data-remove]');
  if (!add && !remove) return;
  if (!workTypesReady || locked()) return;

  const k = e.target.closest('.daycard').dataset.date, r = getDay(k);
  let focusIndex;

  if (add) {
    r.shifts.push(emptyShift());
    focusIndex = r.shifts.length - 1;
  } else {
    r.shifts.splice(Number(remove.dataset.remove), 1);
    if (!r.shifts.length) {
      r.shifts.push(emptyShift());
    }
    focusIndex = Math.min(Number(remove.dataset.remove), r.shifts.length - 1);
  }

  data.days[k] = r;
  persist();
  render();
  $('#start-' + k + '-' + focusIndex).focus();
});

$('#previous').onclick = () => {
  week = T.shift(week, -7);
  void loadSubmission();
};

$('#next').onclick = () => {
  week = T.shift(week, 7);
  void loadSubmission();
};

$('#thisWeek').onclick = () => {
  week = T.monday(new Date());
  void loadSubmission();
};

$('#weekPicker').onchange = e => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) return;
  let d = T.parseDate(e.target.value);
  if (!Number.isNaN(+d)) {
    week = T.monday(d);
    void loadSubmission();
  }
};

$('#submitWeek').onclick = async () => {
  if (!workTypesReady || locked() || !staffClient) return;
  if (updateTotals()) { $('#weekMessage').textContent = 'Complete or remove incomplete shifts before submitting.'; return; }
  const submittedDays = {};
  for (const date of days()) submittedDays[T.key(date)] = getDay(T.key(date));
  if (!Object.values(submittedDays).some(day => day.shifts.some(shift => shift.start || shift.end))) {
    $('#weekMessage').textContent = 'Enter at least one shift before submitting.'; return;
  }
  if (!window.confirm('Submit this week for admin approval? You can edit it again if an admin denies it.')) return;
  const userId = staffId, weekKey = T.key(week);
  submitting = true;
  render();
  try {
    const result = await submissionCall({ action: 'submit-timesheet', week: weekKey, days: submittedDays });
    if (userId !== staffId || weekKey !== T.key(week)) return;
    submission = result.timesheet;
    submissionReady = true;
    Object.assign(data.days, submission.days);
    persist();
    $('#weekMessage').textContent = '';
  } catch (error) {
    if (userId === staffId) $('#weekMessage').textContent = error.message;
  } finally {
    submitting = false;
    if (userId === staffId) {
      const message = $('#weekMessage').textContent;
      render();
      $('#weekMessage').textContent = message;
    }
  }
};

function download(rows, name) {
  const cell = v => '"' + String(/^[=+@\-]/.test(String(v)) ? "'" + v : v).replace(/"/g, '""') + '"';
  let csv = rows.map(r => r.map(cell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  let a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$('#export').onclick = () => {
  if (updateTotals()) {
    $('#weekMessage').textContent = 'Complete or remove the highlighted shifts before exporting.';
    return;
  }

  const rows = days().flatMap(d => {
    const k = T.key(d), r = getDay(k);
    return r.shifts.map((shift, i) => {
      const result = T.duration(shift);
      return [
        k,
        d.toLocaleDateString(undefined, { weekday: 'long' }),
        typeLabel(shift),
        i + 1,
        shift.start,
        shift.end,
        shift.start && shift.end && shift.nextDay ? 'Yes' : 'No',
        result.complete ? (result.minutes / 60).toFixed(2) : '',
        result.complete ? T.format(result.minutes) : ''
      ];
    });
  });
  const total = days().reduce((n, d) => n + T.dayTotal(getDay(T.key(d))).minutes, 0);

  download([
    ['Date', 'Day', 'Work type', 'Shift', 'Start time', 'End time', 'Ends next day', 'Hours', 'Duration'],
    ...rows,
    ['Weekly total', '', '', '', '', '', '', (total / 60).toFixed(2), T.format(total)]
  ], `tempo-week-${T.key(week)}.csv`);
};

})();
