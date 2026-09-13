/**
 * CSV parsing and schema detection for dropped files.
 *
 * A dropped file is more convincing than a "generate synthetic data" button, but it
 * means the columns are no longer known ahead of time. So the schema is inferred and
 * shown back to the user rather than assumed: numeric columns become candidate
 * features, and a column of only 0/1 becomes the candidate label.
 */

export type ColumnKind = "numeric" | "binary" | "other";

export type DetectedColumn = {
  name: string;
  kind: ColumnKind;
  /** A few parsed values, for the preview table. */
  samples: string[];
};

export type DetectedSchema = {
  columns: DetectedColumn[];
  rowCount: number;
  /** Best guess at the label: the last binary column. */
  suggestedLabel: string | null;
  /** Numeric columns other than the label. */
  featureCandidates: string[];
  warnings: string[];
};

export type ParsedDataset = {
  header: string[];
  rows: string[][];
};

/**
 * Deliberately minimal: splits on commas and strips surrounding quotes. It does not
 * handle embedded commas inside quoted fields, and says so rather than corrupting them
 * silently — anything more needs a real parser, which is not what this weekend is for.
 */
export function parseCsv(text: string): ParsedDataset {
  const lines = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => line.trim().length > 0);

  if (lines.length < 2) {
    throw new Error("Need a header row and at least one data row.");
  }

  const header = splitLine(lines[0]);
  const rows = lines.slice(1).map(splitLine);

  const ragged = rows.filter((row) => row.length !== header.length).length;
  if (ragged > 0 && ragged === rows.length) {
    throw new Error("Every row has a different column count than the header.");
  }

  return { header, rows: rows.filter((row) => row.length === header.length) };
}

function splitLine(line: string): string[] {
  return line.split(",").map((cell) => cell.trim().replace(/^"(.*)"$/, "$1"));
}

export function detectSchema(dataset: ParsedDataset): DetectedSchema {
  const warnings: string[] = [];

  const columns: DetectedColumn[] = dataset.header.map((name, index) => {
    const values = dataset.rows.map((row) => row[index]);
    const numeric = values.every((v) => v !== "" && Number.isFinite(Number(v)));
    const binary = numeric && values.every((v) => Number(v) === 0 || Number(v) === 1);

    return {
      name,
      kind: binary ? "binary" : numeric ? "numeric" : "other",
      samples: values.slice(0, 3),
    };
  });

  const binaryColumns = columns.filter((c) => c.kind === "binary");
  const suggestedLabel = binaryColumns.at(-1)?.name ?? null;

  if (!suggestedLabel) {
    warnings.push(
      "No column contains only 0 and 1, so there is no label to train against. " +
        "Add one, or use the synthetic dataset.",
    );
  }

  const featureCandidates = columns
    .filter((c) => c.name !== suggestedLabel && (c.kind === "numeric" || c.kind === "binary"))
    .map((c) => c.name);

  if (featureCandidates.length === 0) {
    warnings.push("No numeric feature columns found; a linear model has nothing to fit.");
  }

  const skipped = dataset.rows.length;
  if (skipped === 0) warnings.push("No usable data rows.");

  const textColumns = columns.filter((c) => c.kind === "other");
  if (textColumns.length > 0) {
    warnings.push(
      `Ignoring non-numeric column(s): ${textColumns.map((c) => c.name).join(", ")}.`,
    );
  }

  return {
    columns,
    rowCount: dataset.rows.length,
    suggestedLabel,
    featureCandidates,
    warnings,
  };
}

/** Numeric matrix plus labels, ready for training. */
export function toMatrix(
  dataset: ParsedDataset,
  features: string[],
  label: string,
): { x: number[][]; y: number[] } {
  const featureIndexes = features.map((name) => dataset.header.indexOf(name));
  const labelIndex = dataset.header.indexOf(label);

  if (labelIndex === -1) throw new Error(`Label column "${label}" not found.`);
  if (featureIndexes.some((i) => i === -1)) throw new Error("A feature column is missing.");

  const x: number[][] = [];
  const y: number[] = [];

  for (const row of dataset.rows) {
    const featureValues = featureIndexes.map((i) => Number(row[i]));
    const labelValue = Number(row[labelIndex]);
    // Rows with an unparseable cell are dropped rather than coerced to zero, which
    // would quietly bias the model.
    if (featureValues.some((v) => !Number.isFinite(v)) || !Number.isFinite(labelValue)) continue;
    x.push(featureValues);
    y.push(labelValue > 0.5 ? 1 : 0);
  }

  return { x, y };
}
