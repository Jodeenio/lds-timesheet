(function (root) {
  function key(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function parseDate(s) {
    return new Date(s + 'T12:00:00');
  }

  function monday(d) {
    d = new Date(d);
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - (d.getDay() + 6) % 7);
    return d;
  }

  function shift(d, n) {
    d = new Date(d);
    d.setDate(d.getDate() + n);
    return d;
  }

  function minutes(s) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s || '')) return null;
    let [h, m] = s.split(':').map(Number);
    return h * 60 + m;
  }

  function duration(row = {}) {
    const { start = '', end = '', nextDay = false } = row;

    if (!start && !end) {
      return { minutes: 0, complete: false, error: '' };
    }
    if (!start || !end) {
      return { minutes: 0, complete: false, error: 'Enter both a start and end time.' };
    }

    let a = minutes(start), b = minutes(end);
    if (a === null || b === null) {
      return { minutes: 0, complete: false, error: 'Enter valid times.' };
    }

    let total = b - a + (nextDay ? 1440 : 0);
    if (total <= 0) {
      return {
        minutes: 0,
        complete: false,
        error: 'End must follow start. For overnight work, select ends next day.'
      };
    }
    if (total > 1440) {
      return { minutes: 0, complete: false, error: 'A daily shift cannot exceed 24 hours.' };
    }

    return { minutes: total, complete: true, error: '' };
  }

  function overtimeType(type) {
    if (type === 'regular') return 'overtime';
    if (type === 'public holiday') return 'public holiday overtime';
    return /^custom:[123]$/.test(type) ? `${type}:overtime` : null;
  }

  function splitOvertime(row, following) {
    const result = duration(row);
    if (!result.complete || result.minutes <= 480 || !overtimeType(row.type)) return [row];
    const overtimeKey = overtimeType(row.type);
    const start = minutes(row.start);
    const boundary = start + 480;
    const clock = n => `${String(Math.floor(n % 1440 / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
    const shifts = [
      { ...row, end: clock(boundary), nextDay: boundary >= 1440 },
      { start: clock(boundary), end: row.end, nextDay: Math.floor((start + result.minutes) / 1440) > Math.floor(boundary / 1440), type: overtimeKey,
        typeLabel: /^custom:[123]$/.test(row.type) && row.typeLabel ? `${row.typeLabel} overtime` : '' }
    ];
    if (following?.type === overtimeKey && following.start === row.end && duration(following).complete) {
      const overtime = shifts[1];
      const total = duration(overtime).minutes + duration(following).minutes;
      // Keep the existing overtime end time when extending its start backwards.
      overtime.end = following.end;
      overtime.nextDay = minutes(overtime.start) + total >= 1440;
      // A shift is limited to 24 hours; retain separate entries if merging exceeds it.
      if (total > 1440) return splitOvertime(row);
    }
    return shifts;
  }

  function rebalanceOvertime(row, following) {
    const overtimeKey = overtimeType(row.type);
    if (!overtimeKey || following?.type !== overtimeKey || row.end !== following.start) return null;
    const regular = duration(row), overtime = duration(following);
    if (!regular.complete || !overtime.complete) return null;
    const total = regular.minutes + overtime.minutes;
    if (total > 1440) return null;
    const combined = { ...row, end: following.end, nextDay: minutes(row.start) + total >= 1440 };
    return splitOvertime(combined);
  }

  function normalizeDay(row = {}) {
    const shifts = Array.isArray(row.shifts) && row.shifts.length ? row.shifts : [row];
    return {
      shifts: shifts.map(s => ({
        start: s.start || '',
        end: s.end || '',
        nextDay: !!s.nextDay,
        type: typeof (s.type ?? row.type) === 'string' ? (s.type ?? row.type) : 'regular',
        typeLabel: typeof s.typeLabel === 'string' ? s.typeLabel : ''
      }))
    };
  }

  function dayTotal(row = {}) {
    const shifts = normalizeDay(row).shifts.map(duration);
    return {
      minutes: shifts.reduce((n, s) => n + s.minutes, 0),
      complete: shifts.some(s => s.complete),
      errors: shifts.filter(s => s.error).length,
      shifts
    };
  }

  function format(n) {
    return `${Math.floor(n / 60)}h ${String(n % 60).padStart(2, '0')}m`;
  }

  root.TempoTime = { key, parseDate, monday, shift, duration, overtimeType, splitOvertime, rebalanceOvertime, normalizeDay, dayTotal, format };
  if (typeof module !== 'undefined') module.exports = root.TempoTime;
})(typeof window !== 'undefined' ? window : globalThis);
