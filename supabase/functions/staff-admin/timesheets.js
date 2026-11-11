import { isManager } from './roles.js';
export function validWeek(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(+date) && date.toISOString().slice(0, 10) === value && date.getUTCDay() === 1;
}

export function validateDays(input, week, types) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Enter at least one complete shift.');
  const days = {}, allowedDates = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date(`${week}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + i);
    allowedDates.push(date.toISOString().slice(0, 10));
  }
  if (Object.keys(input).some(date => !allowedDates.includes(date))) throw new Error('Only submit shifts from the selected week.');
  let total = 0;
  const clock = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  for (const date of allowedDates) {
    const source = input[date];
    if (!source) continue;
    if (!Array.isArray(source.shifts) || source.shifts.length > 50) throw new Error('Each day must have at most 50 shifts.');
    const shifts = [];
    for (const shift of source.shifts) {
      if (!shift || typeof shift !== 'object') throw new Error('Invalid shift.');
      if (!shift.start && !shift.end) continue;
      if (!clock(shift.start) || !clock(shift.end) || typeof shift.nextDay !== 'boolean') throw new Error('Complete all shift times before submitting.');
      const type = types.find(type => type.key === shift.type);
      if (!type) throw new Error('A shift uses a disabled work type. Choose an enabled type before submitting.');
      const minutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
      const duration = minutes(shift.end) - minutes(shift.start) + (shift.nextDay ? 1440 : 0);
      if (duration <= 0 || duration > 1440) throw new Error('Shift lengths must be greater than zero and at most 24 hours.');
      const overtimeKey = type.key === 'regular' ? 'overtime' : type.key === 'public holiday' ? 'public holiday overtime' : /^custom:[123]$/.test(type.key) ? `${type.key}:overtime` : null;
      const overtime = types.find(type => type.key === overtimeKey);
      if (duration > 480 && overtime) {
        const start = minutes(shift.start), boundary = start + 480;
        const boundaryClock = `${String(Math.floor(boundary % 1440 / 60)).padStart(2, '0')}:${String(boundary % 60).padStart(2, '0')}`;
        shifts.push({ start: shift.start, end: boundaryClock, nextDay: boundary >= 1440, type: type.key, typeLabel: type.label, minutes: 480 },
          { start: boundaryClock, end: shift.end, nextDay: Math.floor((start + duration) / 1440) > Math.floor(boundary / 1440), type: overtime.key, typeLabel: overtime.label, minutes: duration - 480 });
      } else {
        shifts.push({ start: shift.start, end: shift.end, nextDay: shift.nextDay, type: type.key, typeLabel: type.label, minutes: duration });
      }
      total += duration;
    }
    // Reject overlapping shifts, including overnight shifts into the next day.
    if (shifts.length) days[date] = { shifts };
  }
  const intervals = Object.entries(days).flatMap(([date, day]) => day.shifts.map(shift => {
    const start = Date.parse(`${date}T${shift.start}:00Z`);
    return [start, start + shift.minutes * 60000];
  })).sort((a, b) => a[0] - b[0]);
  if (intervals.some((entry, i) => i > 0 && entry[0] < intervals[i - 1][1])) throw new Error('Shifts overlap. Correct them before submitting.');
  if (!total) throw new Error('Enter at least one complete shift before submitting.');
  return { days, total };
}

async function employeeTypes(admin, userId) {
  const { data: defaults, error } = await admin.from('work_types').select('key,label');
  const result = userId ? await admin.from('staff_rates').select('work_type_settings').eq('user_id', userId).maybeSingle() : { data: null };
  if (error || result.error || !defaults?.length) throw new Error('Could not load employee work types.');
  const config = result.data?.work_type_settings;
  const keys = config?.enabledDefaults || defaults.map(type => type.key);
  const types = defaults.filter(type => type.key === 'public holiday overtime' ? keys.includes('public holiday') : keys.includes(type.key))
    .map(type => ({ ...type, hidden: type.key === 'public holiday overtime' }));
  if (config?.customEnabled) for (const type of config.customTypes || []) {
    if (type.enabled === false) continue;
    types.push(type, { key: `${type.key}:overtime`, label: `${type.label} overtime`, hidden: true });
  }
  return types;
}

export function adjustmentMarks(before, after, previous = {}) {
  const marks = structuredClone(previous);
  for (const date of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const original = before[date]?.shifts || [], changed = after[date]?.shifts || [];
    const signature = shift => JSON.stringify([shift?.start, shift?.end, shift?.nextDay, shift?.type]);
    const indices = new Set(marks[date] || []);
    for (let i = 0; i < Math.max(original.length, changed.length); i++) {
      if (signature(original[i]) !== signature(changed[i])) indices.add(i);
    }
    if (indices.size) marks[date] = [...indices];
  }
  return marks;
}

export async function withAdjustmentNames(admin, sheets) {
  const names = new Map();
  return await Promise.all(sheets.map(async sheet => {
    if (!sheet.adjusted_at) return sheet;
    let name;
    if (sheet.adjusted_by) {
      if (!names.has(sheet.adjusted_by)) {
        names.set(sheet.adjusted_by, (async () => {
          try {
            const { data, error } = await admin.auth.admin.getUserById(sheet.adjusted_by);
            if (error) return null;
            return data.user?.user_metadata?.full_name?.trim() || null;
          } catch { return null; }
        })());
      }
      name = await names.get(sheet.adjusted_by);
    }
    return { ...sheet, adjusted_by_name: name || 'Unknown Admin' };
  }));
}

export async function handleTimesheets({ admin, user, body, reply }) {
  if (['admin-timesheet', 'adjust-timesheet', 'list-timesheets', 'review-timesheet'].includes(body.action) && !isManager(user)) return reply(403, { error: 'Administrator access required.' });
  if (['admin-timesheet', 'adjust-timesheet'].includes(body.action)) {
    if (typeof body.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.id)) return reply(400, { error: 'Select a valid timesheet.' });
    const { data: sheet, error } = await admin.from('timesheets').select('*').eq('id', body.id).maybeSingle();
    if (error || !sheet) return reply(404, { error: 'Timesheet not found.' });
    let types;
    try { types = await employeeTypes(admin, sheet.user_id); } catch (error) { return reply(502, { error: error.message }); }
    // Keep historical types available when an assignment has since been disabled.
    for (const day of Object.values(sheet.days)) for (const shift of day.shifts) {
      if (!types.some(type => type.key === shift.type)) types.push({ key: shift.type, label: shift.typeLabel || shift.type, hidden: shift.type.endsWith(':overtime') || shift.type === 'public holiday overtime' });
    }
    if (body.action === 'admin-timesheet') return reply(200, { timesheet: sheet, types });
    if (!Number.isSafeInteger(body.revision) || body.revision !== sheet.revision) return reply(409, { error: 'This timesheet changed. Reload before editing again.' });
    let validated;
    try { validated = validateDays(body.days, sheet.week_start, types); } catch (error) { return reply(400, { error: error.message }); }
    const now = new Date().toISOString();
    const marks = adjustmentMarks(sheet.days, validated.days, sheet.adjusted_shifts);
    const history = [...(sheet.adjustment_history || []), { at: now, by: user.id, before: sheet.days, after: validated.days }];
    const { data, error: saveError } = await admin.from('timesheets').update({ days: validated.days, total_minutes: validated.total,
      adjusted_at: now, adjusted_by: user.id, adjusted_shifts: marks, adjustment_history: history, revision: sheet.revision + 1 })
      .eq('id', sheet.id).eq('revision', sheet.revision).select('id');
    if (saveError) return reply(502, { error: 'Could not save adjustments. Check migration 008 has been applied.' });
    if (!data?.length) return reply(409, { error: 'This timesheet changed while you were editing. Reload before saving.' });
    return reply(200, { saved: true });
  }
  if (body.action === 'list-timesheets') {
    const page = body.page ?? 1;
    if (!Number.isSafeInteger(page) || page < 1 || page > 10000) return reply(400, { error: 'Invalid page.' });
    const { data, error } = await admin.from('timesheets').select('*').order('week_start', { ascending: false }).order('submitted_at', { ascending: false }).order('id').range((page - 1) * 50, page * 50);
    if (error) return reply(502, { error: 'Could not load timesheets. Check migration 006 has been applied.' });
    const timesheets = await withAdjustmentNames(admin, data.slice(0, 50));
    return reply(200, { timesheets, hasMore: data.length > 50 });
  }
  if (body.action === 'review-timesheet') {
    if (typeof body.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.id) || !['approved', 'denied'].includes(body.status) || typeof body.submittedAt !== 'string') return reply(400, { error: 'Select a valid timesheet and review action.' });
    const reason = body.status === 'denied' && typeof body.reason === 'string' ? body.reason.trim() : null;
    if (body.status === 'denied' && (!reason || reason.length > 1000)) return reply(400, { error: 'Enter a denial reason between 1 and 1000 characters.' });
    if (!Number.isSafeInteger(body.revision)) return reply(400, { error: 'Refresh the timesheets list before reviewing.' });
    const { data, error } = await admin.from('timesheets').update({ status: body.status, denial_reason: reason, reviewed_by: user.id, reviewed_at: new Date().toISOString(), revision: body.revision + 1 }).eq('id', body.id).eq('status', 'pending').eq('submitted_at', body.submittedAt).eq('revision', body.revision).select('id');
    if (error) return reply(502, { error: 'Could not review timesheet. Try again.' });
    if (!data.length) return reply(409, { error: 'This timesheet has changed or was already reviewed. Refresh the list.' });
    return reply(200, { saved: true });
  }
  if (!validWeek(body.week)) return reply(400, { error: 'Select a valid week starting on Monday.' });
  const { data: existing, error: loadError } = await admin.from('timesheets').select('*').eq('user_id', user.id).eq('week_start', body.week).maybeSingle();
  if (loadError) return reply(502, { error: 'Could not load your submission. Check migration 006 has been applied.' });
  if (body.action === 'my-timesheet') return reply(200, { timesheet: existing });
  if (existing && existing.status !== 'denied') return reply(409, { error: 'This week is already submitted. An administrator must deny it before you can change it.' });
  const { data: defaults, error: typeError } = await admin.from('work_types').select('key,label');
  const { data: row, error: settingsError } = await admin.from('staff_rates').select('work_type_settings').eq('user_id', user.id).maybeSingle();
  if (typeError || settingsError || !defaults?.length) return reply(502, { error: 'Could not verify your work types. Try again.' });
  const config = row?.work_type_settings;
  const keys = config?.enabledDefaults || defaults.map(type => type.key);
  const types = defaults.filter(type => type.key === 'public holiday overtime' ? keys.includes('public holiday') : keys.includes(type.key));
  if (config?.customEnabled) for (const type of config.customTypes || []) {
    if (type.enabled === false) continue;
    types.push(type, { key: `${type.key}:overtime`, label: `${type.label} overtime` });
  }
  let validated;
  try { validated = validateDays(body.days, body.week, types); } catch (error) { return reply(400, { error: error.message }); }
  const payload = { user_id: user.id, employee_name: user.user_metadata?.full_name || user.email || 'Staff', employee_email: user.email || '', week_start: body.week, days: validated.days, total_minutes: validated.total, status: 'pending', submitted_at: new Date().toISOString(), reviewed_at: null, reviewed_by: null, denial_reason: null };
  const query = existing
    ? admin.from('timesheets').update({ ...payload, revision: existing.revision + 1 }).eq('id', existing.id).eq('status', 'denied').eq('submitted_at', existing.submitted_at).eq('revision', existing.revision)
    : admin.from('timesheets').insert(payload);
  const { data, error } = await query.select('*');
  if (error || !data?.length) return reply(409, { error: 'Could not submit. Refresh this week to check whether it was already submitted, then try again.' });
  return reply(200, { timesheet: data[0] });
}
