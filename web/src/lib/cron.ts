export function describeCron(expression: string): string {
  const parts = expression.trim().split(/\s+/);
  if (parts.length < 5) return expression;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  // Every minute
  if (minute === "*" && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return "Runs every minute";
  }

  // Every N minutes
  if (minute?.startsWith("*/") && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    const n = minute.slice(2);
    return `Runs every ${n} minute${n === "1" ? "" : "s"}`;
  }

  // Every N hours
  if (minute !== "*" && hour?.startsWith("*/") && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    const n = hour.slice(2);
    return `Runs every ${n} hour${n === "1" ? "" : "s"} at minute ${minute}`;
  }

  // Specific time every day
  if (minute !== "*" && hour !== "*" && !hour?.includes("/") && !hour?.includes(",") && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return `Runs daily at ${pad(hour)}:${pad(minute)}`;
  }

  // Specific time on specific days of the week
  if (minute !== "*" && hour !== "*" && dayOfMonth === "*" && month === "*" && dayOfWeek !== "*") {
    const days = parseDaysOfWeek(dayOfWeek);
    return `Runs at ${pad(hour)}:${pad(minute)} on ${days}`;
  }

  // Specific time on specific day of month
  if (minute !== "*" && hour !== "*" && dayOfMonth !== "*" && month === "*" && dayOfWeek === "*") {
    return `Runs at ${pad(hour)}:${pad(minute)} on day ${dayOfMonth} of every month`;
  }

  // Hourly at specific minute
  if (minute !== "*" && !minute?.includes("/") && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return `Runs hourly at minute ${minute}`;
  }

  return `Cron: ${expression}`;
}

function pad(value: string | undefined): string {
  if (!value) return "00";
  return value.padStart(2, "0");
}

function parseDaysOfWeek(dow: string): string {
  const dayNames: Record<string, string> = {
    "0": "Sunday",
    "1": "Monday",
    "2": "Tuesday",
    "3": "Wednesday",
    "4": "Thursday",
    "5": "Friday",
    "6": "Saturday",
    "7": "Sunday",
    SUN: "Sunday",
    MON: "Monday",
    TUE: "Tuesday",
    WED: "Wednesday",
    THU: "Thursday",
    FRI: "Friday",
    SAT: "Saturday",
  };

  // Handle ranges like 1-5
  if (dow.includes("-")) {
    const [start, end] = dow.split("-");
    const startName = dayNames[start?.toUpperCase() ?? ""] ?? start;
    const endName = dayNames[end?.toUpperCase() ?? ""] ?? end;
    return `${startName} through ${endName}`;
  }

  // Handle comma-separated lists
  const days = dow.split(",").map((d) => dayNames[d.toUpperCase()] ?? d);
  if (days.length === 1) return days[0];
  if (days.length === 2) return `${days[0]} and ${days[1]}`;
  return days.slice(0, -1).join(", ") + ", and " + days[days.length - 1];
}
