// Minimal standard 5-field cron parser + next-run calculator.
//
// Fields (in order): minute, hour, day-of-month, month, day-of-week.
// Supported syntax per field:
//   *           — all values
//   N           — single value
//   A,B,C       — list
//   A-B         — range
//   A-B/N or */N — step (A-B/N restricts to range; */N applies to full range)
//
// Day-of-week: 0 or 7 = Sunday, 1 = Monday … (standard Unix cron).
//
// Matching semantics: when both day-of-month and day-of-week are restricted
// (i.e. neither is "*"), Vixie cron uses an OR between them — we follow that.

interface CronExpr {
  minutes: Set<number>;
  hours: Set<number>;
  doms: Set<number>;
  months: Set<number>;
  dows: Set<number>;
  domStar: boolean;
  dowStar: boolean;
}

const FIELD_RANGES: Array<[number, number]> = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
];

function parseField(raw: string, [min, max]: [number, number]): Set<number> {
  const out = new Set<number>();
  for (const part of raw.split(",")) {
    const stepMatch = part.match(/^(.+?)\/(\d+)$/);
    const body = stepMatch ? stepMatch[1] : part;
    const step = stepMatch ? parseInt(stepMatch[2], 10) : 1;
    if (!(step >= 1)) throw new Error(`Invalid step in cron field: "${part}"`);

    let lo: number, hi: number;
    if (body === "*") {
      lo = min;
      hi = max;
    } else if (body.includes("-")) {
      const [a, b] = body.split("-").map((n) => parseInt(n, 10));
      if (Number.isNaN(a) || Number.isNaN(b)) {
        throw new Error(`Invalid range in cron field: "${part}"`);
      }
      lo = a;
      hi = b;
    } else {
      const v = parseInt(body, 10);
      if (Number.isNaN(v)) throw new Error(`Invalid cron field value: "${part}"`);
      lo = v;
      hi = v;
    }
    if (lo < min || hi > max || lo > hi) {
      throw new Error(`Cron field out of range [${min}-${max}]: "${part}"`);
    }
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

export function parseCron(expr: string): CronExpr {
  const trimmed = expr.trim().replace(/\s+/g, " ");
  const parts = trimmed.split(" ");
  if (parts.length !== 5) {
    throw new Error(
      `Cron expression must have 5 fields (minute hour dom month dow), got ${parts.length}: "${expr}"`,
    );
  }
  const [mRaw, hRaw, domRaw, monRaw, dowRaw] = parts;
  const minutes = parseField(mRaw, FIELD_RANGES[0]);
  const hours = parseField(hRaw, FIELD_RANGES[1]);
  const doms = parseField(domRaw, FIELD_RANGES[2]);
  const months = parseField(monRaw, FIELD_RANGES[3]);
  const dowsRaw = parseField(dowRaw, FIELD_RANGES[4]);
  const dows = new Set<number>();
  for (const v of dowsRaw) dows.add(v === 7 ? 0 : v);

  return {
    minutes,
    hours,
    doms,
    months,
    dows,
    domStar: domRaw === "*",
    dowStar: dowRaw === "*",
  };
}

/**
 * Return the next Date strictly after `after` that matches the cron expression.
 * Iterates minute-by-minute with month/day fast-forwarding. Capped at ~5
 * years lookahead to guard against unsatisfiable expressions.
 */
export function nextRun(expr: string | CronExpr, after: Date = new Date()): Date {
  const c = typeof expr === "string" ? parseCron(expr) : expr;
  const cursor = new Date(after.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  const limit = new Date(after.getTime() + 5 * 366 * 24 * 60 * 60 * 1000);
  while (cursor <= limit) {
    const month = cursor.getMonth() + 1;
    if (!c.months.has(month)) {
      cursor.setMonth(cursor.getMonth() + 1, 1);
      cursor.setHours(0, 0, 0, 0);
      continue;
    }
    const dom = cursor.getDate();
    const dow = cursor.getDay();
    const dayOk = c.domStar && c.dowStar
      ? true
      : c.domStar
        ? c.dows.has(dow)
        : c.dowStar
          ? c.doms.has(dom)
          : c.doms.has(dom) || c.dows.has(dow);
    if (!dayOk) {
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(0, 0, 0, 0);
      continue;
    }
    if (!c.hours.has(cursor.getHours())) {
      cursor.setHours(cursor.getHours() + 1, 0, 0, 0);
      continue;
    }
    if (!c.minutes.has(cursor.getMinutes())) {
      cursor.setMinutes(cursor.getMinutes() + 1, 0, 0);
      continue;
    }
    return cursor;
  }
  throw new Error(`No next run found within 5 years for cron expression`);
}

export function validateCron(expr: string): { ok: true; next: Date } | { ok: false; error: string } {
  try {
    const next = nextRun(expr);
    return { ok: true, next };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
