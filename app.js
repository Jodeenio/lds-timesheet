const $ = s => document.querySelector(s),
  T = TempoTime;

let data = { days: {} };
let storageError = false;

try {
  const saved = JSON.parse(localStorage.getItem('tempo-weekly-v1'));
  if (saved && saved.days && typeof saved.days === 'object' && !Array.isArray(saved.days)) {
    data = saved;
  }
} catch {
  storageError = true;
}

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
  try {
    localStorage.setItem('tempo-weekly-v1', JSON.stringify(data));
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
      (shift.type === 'public holiday overtime' ? '<option value="public holiday overtime" selected hidden disabled>Public holiday overtime</option>' : '') +
      `<option value="regular" ${shift.type === 'regular' ? 'selected' : ''}>Regular</option>` +
      `<option value="overtime" ${shift.type === 'overtime' ? 'selected' : ''}>Overtime</option>` +
      `<option value="public holiday" ${shift.type === 'public holiday' ? 'selected' : ''}>Public holiday</option>` +
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
  const field = e.target.dataset.field,
    isType = e.target.matches('[data-type]');
  if (!field && !isType) return;

  const k = e.target.closest('.daycard').dataset.date, r = getDay(k);
  let i = Number(e.target.closest('.shiftrow').dataset.shift);

  if (isType) {
    r.shifts[i].type = e.target.value;
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
  handleEdit(e);
  const k = e.target.closest('.daycard').dataset.date;
  const i = Number(e.target.closest('.shiftrow').dataset.shift);
  const r = getDay(k);
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

  const k = e.target.closest('.daycard').dataset.date, r = getDay(k);
  let focusIndex;

  if (add) {
    r.shifts.push({ start: '', end: '', nextDay: false, type: 'regular' });
    focusIndex = r.shifts.length - 1;
  } else {
    r.shifts.splice(Number(remove.dataset.remove), 1);
    if (!r.shifts.length) {
      r.shifts.push({ start: '', end: '', nextDay: false, type: 'regular' });
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
  render();
};

$('#next').onclick = () => {
  week = T.shift(week, 7);
  render();
};

$('#thisWeek').onclick = () => {
  week = T.monday(new Date());
  render();
};

$('#weekPicker').onchange = e => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) return;
  let d = T.parseDate(e.target.value);
  if (!Number.isNaN(+d)) {
    week = T.monday(d);
    render();
  }
};

$('#saveWeek').onclick = () => {
  let errors = updateTotals();
  if (!persist()) return;
  $('#weekMessage').textContent = errors
    ? 'Draft saved. Complete the highlighted shifts to include them in the total.'
    : 'Week saved on this device.';
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
        shift.type === 'public holiday overtime' ? 'Public holiday overtime' : shift.type === 'public holiday' ? 'Public holiday' : shift.type === 'overtime' ? 'Overtime' : 'Regular',
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

try {
  const legacy = JSON.parse(localStorage.getItem('tempo-v1'));
  if (legacy?.entries?.length || legacy?.running) {
    $('#legacy').hidden = false;
    $('#exportLegacy').onclick = () => {
      const entries = [...(legacy.entries || [])];
      if (legacy.running) {
        entries.push({
          ...legacy.running,
          seconds: Math.max(0, Math.floor((Date.now() - legacy.running.at) / 1000)),
          description: legacy.running.description + ' (previous timer snapshot)'
        });
      }
      download([
        ['Date', 'Description', 'Project', 'Seconds'],
        ...entries.map(e => [
          T.key(new Date(e.at)),
          e.description,
          (legacy.projects || []).find(p => p.id === e.project)?.name || '',
          e.seconds
        ])
      ], 'tempo-earlier-entries.csv');
    };
  }
} catch {}

render();
