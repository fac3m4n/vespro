/**
 * Synthetic wearable data.
 *
 * Synthetic on purpose. The demo needs data that looks like the real thing without
 * anyone's actual resting heart rate being uploaded to a public testnet, and Arkiv's
 * own brief is explicit that personal data does not belong in entities. Nothing in
 * Vespro's index carries a measurement either way — but the dataset should not need
 * that guarantee to be safe to publish.
 */

export const COLUMNS = [
  { name: "resting_hr", unit: "bpm" },
  { name: "sleep_hours", unit: "h" },
  { name: "steps", unit: "count" },
  { name: "recovered", unit: "bool" },
] as const;

export type Row = { resting_hr: number; sleep_hours: number; steps: number; recovered: number };

/**
 * Deterministic, so a listing's row count and the model a buyer gets back are
 * reproducible across reloads and across the two demo windows.
 */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateRows(count: number, seed = 42): Row[] {
  const rand = mulberry32(seed);
  const rows: Row[] = [];

  for (let i = 0; i < count; i++) {
    const restingHr = 48 + rand() * 40;
    const sleepHours = 4 + rand() * 5;
    const steps = 1500 + rand() * 14000;

    // A real signal for the model to find: good sleep and activity with a low resting
    // heart rate means recovered, plus noise so it is not perfectly separable.
    const score =
      (sleepHours - 7) * 0.9 + (steps - 8000) / 6000 - (restingHr - 62) * 0.08 + (rand() - 0.5);

    rows.push({
      resting_hr: round(restingHr, 1),
      sleep_hours: round(sleepHours, 2),
      steps: Math.round(steps),
      recovered: score > 0 ? 1 : 0,
    });
  }

  return rows;
}

export function toCsv(rows: Row[]): string {
  const header = COLUMNS.map((c) => c.name).join(",");
  const body = rows.map((r) => `${r.resting_hr},${r.sleep_hours},${r.steps},${r.recovered}`);
  return [header, ...body].join("\n");
}

export function fromCsv(csv: string): Row[] {
  const [, ...lines] = csv.trim().split("\n");
  return lines.filter(Boolean).map((line) => {
    const [hr, sleep, steps, recovered] = line.split(",").map(Number);
    return { resting_hr: hr, sleep_hours: sleep, steps, recovered };
  });
}

function round(value: number, places: number) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
