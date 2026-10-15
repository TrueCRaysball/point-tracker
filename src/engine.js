// Attendance rules engine — a direct port of Engine.swift / Day.swift.
// Days are whole numbers (days since 1970-01-01, UTC) so date math never drifts.

const MS = 86400000;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
  "September", "October", "November", "December"];

export const Day = {
  parse(s) {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d) / MS;
  },
  iso(n) {
    return new Date(n * MS).toISOString().slice(0, 10);
  },
  today() {
    const t = new Date();
    return Date.UTC(t.getFullYear(), t.getMonth(), t.getDate()) / MS;
  },
  add(n, days) { return n + days; },
  /** Calendar-month math that clamps to the month's last day (Jan 31 + 1 month = Feb 28), like Foundation. */
  addMonths(n, months) {
    const d = new Date(n * MS);
    const y = d.getUTCFullYear(), m = d.getUTCMonth() + months, day = d.getUTCDate();
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return Date.UTC(y, m, Math.min(day, last)) / MS;
  },
  short(n) {
    const d = new Date(n * MS);
    return `${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
  },
  long(n) {
    const d = new Date(n * MS);
    return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
  },
};

export const ENTRY_TYPES = {
  callSick: "Call In Sick",
  callPersonal: "Call In Personal",
  worked: "Worked / Returned",
  ado: "ADO",
  pickedUp: "Picked Up Shift",
  dropped: "Dropped Shift",
  other: "Other",
};
export const HIDDEN_TYPES = new Set(["worked", "ado", "pickedUp", "dropped"]);

export const STRING_MODES = {
  auto: "Automatic",
  forceNew: "New point (start new occurrence)",
  forceContinue: "No point (continue previous occurrence)",
};

export function defaultSettings() {
  return {
    rules: [
      { id: crypto.randomUUID().toUpperCase(), days: 30, threshold: 3 },
      { id: crypto.randomUUID().toUpperCase(), days: 90, threshold: 6 },
      { id: crypto.randomUUID().toUpperCase(), days: 180, threshold: 9 },
      { id: crypto.randomUUID().toUpperCase(), days: 365, threshold: 12 },
    ],
    sickPoints: 1,
    personalPoints: 1,
    sickStringGapDays: 7,
    maxSickString: 5,
    terminationAt: 4,
    reprimandMonths: 12,
    dropOffBufferDays: 0,
    dropOffWarningDays: 2,
    /// Days after reprimands expire to show the "check with leadership" notice.
    expiryWarningDays: 2,
    autosaveSeconds: 60,
  };
}

export const sortedRules = (s) => [...s.rules].sort((a, b) => a.days - b.days);
export const displayType = (e) => (e.type === "other" && e.otherLabel ? e.otherLabel : ENTRY_TYPES[e.type]);
export const fmtPts = (x) => String(Math.round(x * 100) / 100);

export function relative(d, asOf) {
  const n = d - asOf;
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  return n < 0 ? `${-n} days ago` : `in ${n} days`;
}

/** Entries in date order; same-day entries in the order they were added. */
export function sortEntries(entries) {
  return [...entries].sort((a, b) =>
    a.date !== b.date ? (a.date < b.date ? -1 : 1) : (a.created < b.created ? -1 : a.created > b.created ? 1 : 0));
}

export const windowStart = (rule, asOf, s) => asOf - (rule.days + s.dropOffBufferDays - 1);
export const dropOff = (d, rule, s) => d + rule.days + s.dropOffBufferDays;

/** Scores every entry in date order, applying the sick-occurrence rules. */
export function run(entries, s, through = null) {
  const st = { active: false, count: 0, number: 0, lastSick: null };
  const out = new Map();
  const starts = [];
  const longest = sortedRules(s).at(-1) ?? { days: 365 };
  const newOccurrence = (d) => {
    starts.push(d);
    const since = windowStart(longest, d, s);
    return starts.filter((x) => x >= since).length;
  };

  for (const e of sortEntries(entries)) {
    const date = Day.parse(e.date);
    if (through !== null && date > through) break;
    const ev = { basePoints: 0, points: 0, stringNumber: null, stringPosition: null, medicalLeave: false };
    switch (e.type) {
      case "callSick": {
        let continues;
        if (e.stringMode === "forceNew") continues = false;
        else if (e.stringMode === "forceContinue") continues = st.lastSick !== null;
        else continues = st.active && st.lastSick !== null && date - st.lastSick <= s.sickStringGapDays;
        if (continues) st.count += 1;
        else { st.count = 1; st.number = newOccurrence(date); }
        st.active = true;
        st.lastSick = date;
        ev.stringNumber = st.number;
        ev.stringPosition = st.count;
        ev.basePoints = st.count === 1 ? s.sickPoints : 0;
        ev.medicalLeave = st.count > s.maxSickString;
        break;
      }
      case "callPersonal":
        ev.basePoints = s.personalPoints;
        ev.stringNumber = newOccurrence(date);
        st.active = false;
        break;
      case "other":
        ev.basePoints = e.otherPoints ?? 0;
        if (e.otherBreaksString !== false) st.active = false;
        break;
      default:
        st.active = false;
    }
    ev.points = e.pointsOverride ?? ev.basePoints;
    out.set(e.id, ev);
  }
  return { evals: out, string: st };
}

/** Entry ID → ID of the reprimand that used it up. */
export function neutralized(reps) {
  const map = new Map();
  for (const r of [...reps].sort((a, b) => (a.signedDate < b.signedDate ? -1 : 1)))
    for (const id of r.pointEntryIDs ?? []) if (!map.has(id)) map.set(id, r.id);
  return map;
}

export const ownExpiry = (r, s) =>
  r.expirationOverride ? Day.parse(r.expirationOverride) : Day.addMonths(Day.parse(r.signedDate), s.reprimandMonths);

/** Reprimands signed before the current group expires join it; the group expires with its newest. */
export function groups(reps, s) {
  const gs = [];
  for (const r of [...reps].sort((a, b) => (a.signedDate < b.signedDate ? -1 : 1))) {
    const last = gs.at(-1);
    if (last && Day.parse(r.signedDate) < last.expires) {
      last.reprimands.push(r);
      last.expires = ownExpiry(r, s);
    } else {
      gs.push({ reprimands: [r], expires: ownExpiry(r, s) });
    }
  }
  for (const g of gs) g.latestSigned = Day.parse(g.reprimands.at(-1).signedDate);
  return gs;
}

/** Everything the dashboard needs, computed as of one day. */
export function evaluate(data, asOf) {
  const s = data.settings;
  const { evals } = run(data.entries, s);
  const { string } = run(data.entries, s, asOf);
  const stringOpenThrough =
    string.active && string.lastSick !== null && asOf <= string.lastSick + s.sickStringGapDays
      ? string.lastSick + s.sickStringGapDays : null;

  const reps = data.reprimands.filter((r) => Day.parse(r.signedDate) <= asOf);
  const neutralizedBy = neutralized(reps);
  const gs = groups(reps, s);
  const lastGroup = gs.at(-1);
  const activeGroup = lastGroup && lastGroup.expires > asOf ? lastGroup : null;
  // Reprimand groups that expired within the last few days (to double-check with leadership).
  const recentlyExpired = gs.filter((g) => g.expires <= asOf && asOf - g.expires < (s.expiryWarningDays ?? 2));

  const entries = sortEntries(data.entries);
  const windows = [];
  const positions = new Map();
  for (const rule of sortedRules(s)) {
    const since = windowStart(rule, asOf, s);
    let eligible = 0, neutral = 0, oldest = null;
    for (const e of entries) {
      const d = Day.parse(e.date);
      const p = evals.get(e.id)?.points ?? 0;
      if (d < since || d > asOf || p <= 0) continue;
      if (neutralizedBy.has(e.id)) { neutral += p; continue; }
      eligible += p;
      if (!positions.has(e.id)) positions.set(e.id, {});
      positions.get(e.id)[rule.id] = eligible;
      oldest ??= e;
    }
    const recentlyDropped = entries.filter((e) => {
      if ((evals.get(e.id)?.points ?? 0) <= 0 || neutralizedBy.has(e.id)) return false;
      const since = asOf - dropOff(Day.parse(e.date), rule, s);
      return since >= 0 && since < s.dropOffWarningDays;
    }).map((e) => ({ entry: e, droppedOn: dropOff(Day.parse(e.date), rule, s) }));
    windows.push({
      rule, since, eligible, neutralized: neutral, oldest,
      dropsOff: oldest ? dropOff(Day.parse(oldest.date), rule, s) : null,
      remaining: Math.max(0, rule.threshold - eligible),
      earned: eligible >= rule.threshold,
      recentlyDropped,
    });
  }

  return {
    asOf, settings: s, evals, neutralizedBy, windows, positions, entries,
    groups: gs, activeGroup, activeCount: activeGroup?.reprimands.length ?? 0, recentlyExpired,
    string, stringOpenThrough,
  };
}

/** Keys for confirmations: a point leaving one window, and a reprimand group expiring. */
export const dropOffKey = (entryId, ruleId) => `${entryId}|${ruleId}`;
export const expiryKey = (group) => `${group.reprimands[0].id}|${Day.iso(group.expires)}`;

/** Unused points inside a rule's window as of the signing date. */
export function suggestedPoints(data, ruleDays, signed, excludingId) {
  const s = data.settings;
  const { evals } = run(data.entries, s);
  const used = neutralized(data.reprimands.filter((r) => r.id !== excludingId));
  const rule = s.rules.find((r) => r.days === ruleDays) ?? { days: ruleDays, threshold: 0 };
  const start = windowStart(rule, signed, s);
  return sortEntries(data.entries)
    .filter((e) => {
      const d = Day.parse(e.date);
      return d >= start && d <= signed && (evals.get(e.id)?.points ?? 0) > 0 && !used.has(e.id);
    })
    .map((e) => e.id);
}

/** Color by how close a window is to a reprimand. The 30-day window goes by points instead. */
export function severity(rule, points) {
  if (points >= rule.threshold) return "red";
  if (rule.days === 30) return points < 1 ? "calm" : points < 2 ? "yellow" : "red";
  const f = rule.threshold > 0 ? points / rule.threshold : 1;
  return f < 0.15 ? "calm" : f < 0.3 ? "green" : f < 0.5 ? "yellow" : f < 0.8 ? "orange" : "red";
}
