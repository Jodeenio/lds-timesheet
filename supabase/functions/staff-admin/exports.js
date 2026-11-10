const rateColumns = { regular: 'regular', overtime: 'overtime', 'public holiday': 'public_holiday', 'public holiday overtime': 'public_holiday_overtime' };
const roundDivide = (value, divisor) => (value + divisor / 2n) / divisor;
const money = cents => `${cents < 0n ? '-' : ''}${(cents < 0n ? -cents : cents) / 100n}.${String((cents < 0n ? -cents : cents) % 100n).padStart(2, '0')}`;
function scaled(value) {
  const text = String(value);
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new Error('Invalid saved monetary setting.');
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}
function csvCell(value) {
  let text = String(value ?? '');
  // Protect identity/work-type text when opened in spreadsheet applications.
  if (/^[\s]*[=+@-]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function buildTimesheetCSV(sheets, settings, includeRates) {
  const headers = ['Row', 'Employee', 'Email', 'Week starting', 'Date', 'Day', 'Work type', 'Start', 'End', 'Ends next day', 'Hours', 'Status'];
  if (includeRates) headers.push('Hourly rate (AUD)', 'Amount (AUD)', 'Tax operation', 'Tax percent', 'Tax adjustment (AUD)', 'Weekly total after tax (AUD)', 'Calculation');
  const rows = [headers], summaries = [];
  for (const sheet of sheets) {
    const rates = settings.get(sheet.user_id);
    if (includeRates && !rates) throw new Error(`Rates are unavailable for ${sheet.employee_name}. Set their rates or download without rates.`);
    let total = 0n;
    const base = (kind, date = '', day = '', type = '', start = '', end = '', overnight = '', hours = '') =>
      [kind, sheet.employee_name, sheet.employee_email, sheet.week_start, date, day, type, start, end, overnight, hours, sheet.status];
    for (let offset = 0; offset < 7; offset++) {
      const date = new Date(`${sheet.week_start}T12:00:00Z`);
      date.setUTCDate(date.getUTCDate() + offset);
      const key = date.toISOString().slice(0, 10), day = date.toLocaleDateString('en-AU', { weekday: 'long', timeZone: 'UTC' });
      let dayMinutes = 0, dayCents = 0n;
      for (const shift of sheet.days[key]?.shifts || []) {
        dayMinutes += shift.minutes;
        const row = base('Shift', key, day, shift.typeLabel || shift.type, shift.start, shift.end, shift.nextDay ? 'Yes' : 'No', (shift.minutes / 60).toFixed(2));
        if (includeRates) {
          const rate = rateColumns[shift.type] ? rates[rateColumns[shift.type]] : rates.custom_rates?.[shift.type];
          if (rate === null || rate === undefined) throw new Error(`Set the ${shift.typeLabel || shift.type} rate for ${sheet.employee_name} before downloading with rates.`);
          const rateCents = scaled(rate);
          const amount = roundDivide(BigInt(shift.minutes) * rateCents, 60n);
          dayCents += amount;
          row.push(money(rateCents), money(amount), '', '', '', '', '');
        }
        rows.push(row);
      }
      const dayRow = base('Daily total', key, day, '', '', '', '', (dayMinutes / 60).toFixed(2));
      if (includeRates) dayRow.push('', money(dayCents), '', '', '', '', '');
      rows.push(dayRow);
      total += dayCents;
    }
    const summary = { employee: sheet.employee_name, week: sheet.week_start, minutes: sheet.total_minutes };
    const weekRow = base('Weekly total', '', '', '', '', '', '', (sheet.total_minutes / 60).toFixed(2));
    if (includeRates) {
      const mode = rates.tax_mode || 'none', percent = mode === 'none' ? 0n : scaled(rates.tax_percent || 0);
      if (!['none', 'add', 'subtract'].includes(mode) || percent > 10000n) throw new Error(`Invalid tax settings for ${sheet.employee_name}.`);
      const tax = roundDivide(total * percent, 10000n);
      const adjusted = mode === 'add' ? total + tax : mode === 'subtract' ? total - tax : total;
      const calculation = mode === 'none' ? `${money(total)} = ${money(adjusted)}` : `${money(total)} ${mode === 'add' ? '+' : '-'} ${money(tax)} (${money(percent)}%) = ${money(adjusted)}`;
      weekRow.push('', money(total), mode, money(percent), money(mode === 'subtract' ? -tax : mode === 'add' ? tax : 0n), money(adjusted), calculation);
      Object.assign(summary, { gross: money(total), taxMode: mode, taxPercent: money(percent), tax: money(tax), total: money(adjusted), calculation });
    }
    rows.push(weekRow);
    summaries.push(summary);
  }
  return { csv: '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n'), summaries };
}

export async function handleExport({ admin, user, body, reply }) {
  if (user.app_metadata?.role !== 'admin') return reply(403, { error: 'Administrator access required.' });
  if (typeof body.includeRates !== 'boolean') return reply(400, { error: 'Choose whether to include rates.' });
  const individual = typeof body.id === 'string';
  if (individual ? !/^[0-9a-f-]{36}$/i.test(body.id) : typeof body.week !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.week)) return reply(400, { error: 'Select a valid sheet or week.' });
  const sheets = [];
  // Fetch the entire approved week, independent of dashboard pagination.
  for (let offset = 0; ; offset += 500) {
    let query = admin.from('timesheets').select('id,user_id,employee_name,employee_email,week_start,days,total_minutes,status').order('id');
    query = individual ? query.eq('id', body.id) : query.eq('week_start', body.week).eq('status', 'approved');
    const { data, error } = await query.range(offset, offset + 499);
    if (error) return reply(502, { error: 'Could not load timesheets for download.' });
    sheets.push(...data);
    if (individual || data.length < 500) break;
  }
  if (!sheets.length) return reply(404, { error: individual ? 'Timesheet not found.' : 'There are no approved timesheets for this week.' });
  const settings = new Map();
  if (body.includeRates) {
    const ids = [...new Set(sheets.map(sheet => sheet.user_id).filter(Boolean))];
    for (let offset = 0; offset < ids.length; offset += 100) {
      const { data, error } = await admin.from('staff_rates').select('user_id,regular,overtime,public_holiday,public_holiday_overtime,custom_rates,tax_mode,tax_percent').in('user_id', ids.slice(offset, offset + 100));
      if (error) return reply(502, { error: 'Could not load rates and tax settings. Check the export tax settings migration has been applied.' });
      data.forEach(row => settings.set(row.user_id, row));
    }
  }
  try {
    const output = buildTimesheetCSV(sheets, settings, body.includeRates);
    return reply(200, { ...output, filename: individual ? `timesheet-${sheets[0].week_start}-${sheets[0].id}.csv` : `approved-timesheets-${body.week}.csv` });
  } catch (error) { return reply(400, { error: error.message }); }
}
