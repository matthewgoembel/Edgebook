const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(tz, f);
  }
  return f;
}

/** Wall-clock parts of an instant in a time zone. */
export function wallClock(ts: number, tz: string) {
  const parts = Object.fromEntries(formatter(tz).formatToParts(new Date(ts)).map((p) => [p.type, p.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const time = `${parts.hour}:${parts.minute}:${parts.second}`;
  return { date, time, minutes: Number(parts.hour) * 60 + Number(parts.minute) + Number(parts.second) / 60 };
}

function tzOffsetMs(ts: number, tz: string) {
  const { date, time } = wallClock(ts, tz);
  return Date.parse(`${date}T${time}Z`) - Math.floor(ts / 1000) * 1000;
}

/** Epoch ms of a wall-clock moment (`YYYY-MM-DD`, minutes after midnight) in a time zone. */
export function zonedTs(date: string, minutes: number, tz: string) {
  const guess = Date.parse(`${date}T00:00:00Z`) + minutes * 60_000;
  const first = guess - tzOffsetMs(guess, tz);
  return guess - tzOffsetMs(first, tz);
}

export function addDays(date: string, n: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function weekday(date: string) {
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(`${date}T12:00:00Z`).getUTCDay()];
}

export function today(tz: string) {
  return wallClock(Date.now(), tz).date;
}
