import { COLUMNS, type Row } from "./dataset";

/**
 * Logistic regression, trained on the data owner's side.
 *
 * This is the piece that makes the privacy claim literal rather than aspirational.
 * The buyer sends hyperparameters and receives four weights, a bias and a loss curve.
 * They never receive a row, and they never receive the decryption key — so "the model
 * gets trained and I stay private" is a description of the data flow, not a promise
 * about how someone will behave with a copy of your data.
 *
 * It is honestly one round of federated learning with a single participant. What it is
 * *not* is training under encryption: the owner's own browser does decrypt locally,
 * because it holds the key. Doing this without any decryption at all means FHE, which
 * is real but nowhere near interactive speed. The README says so plainly rather than
 * letting the demo imply otherwise.
 */

export type TrainedModel = {
  featureNames: string[];
  weights: number[];
  bias: number;
  loss: number[];
  rowsUsed: number;
  accuracy: number;
};

const FEATURES = COLUMNS.filter((c) => c.name !== "recovered").map((c) => c.name);

export function trainLogistic(
  rows: Row[],
  options: { epochs: number; learningRate: number },
  onEpoch?: (epoch: number, loss: number) => void,
): TrainedModel {
  if (rows.length === 0) throw new Error("No rows to train on.");

  const raw = rows.map((r) => [r.resting_hr, r.sleep_hours, r.steps]);
  const labels = rows.map((r) => r.recovered);

  // Standardise, or `steps` in the thousands drowns the other two features entirely.
  const means = FEATURES.map((_, j) => mean(raw.map((r) => r[j])));
  const deviations = FEATURES.map((_, j) => {
    const sd = stdDev(raw.map((r) => r[j]), means[j]);
    return sd === 0 ? 1 : sd;
  });
  const x = raw.map((row) => row.map((value, j) => (value - means[j]) / deviations[j]));

  let weights = new Array(FEATURES.length).fill(0);
  let bias = 0;
  const loss: number[] = [];

  for (let epoch = 0; epoch < options.epochs; epoch++) {
    const gradW = new Array(FEATURES.length).fill(0);
    let gradB = 0;
    let epochLoss = 0;

    for (let i = 0; i < x.length; i++) {
      const z = dot(weights, x[i]) + bias;
      const p = sigmoid(z);
      const error = p - labels[i];

      for (let j = 0; j < weights.length; j++) gradW[j] += error * x[i][j];
      gradB += error;

      // Clamped so a saturated sigmoid gives -Infinity instead of NaN-ing the curve.
      const clamped = Math.min(Math.max(p, 1e-12), 1 - 1e-12);
      epochLoss += -(labels[i] * Math.log(clamped) + (1 - labels[i]) * Math.log(1 - clamped));
    }

    const n = x.length;
    weights = weights.map((w, j) => w - options.learningRate * (gradW[j] / n));
    bias -= options.learningRate * (gradB / n);

    const averaged = epochLoss / n;
    loss.push(round(averaged));
    onEpoch?.(epoch, averaged);
  }

  const correct = x.reduce((total, row, i) => {
    const predicted = sigmoid(dot(weights, row) + bias) > 0.5 ? 1 : 0;
    return total + (predicted === labels[i] ? 1 : 0);
  }, 0);

  return {
    featureNames: [...FEATURES],
    // Rescaled back to the original units, so the weights mean something to the buyer
    // without them needing our normalisation constants.
    weights: weights.map((w, j) => round(w / deviations[j])),
    bias: round(bias - weights.reduce((acc, w, j) => acc + (w * means[j]) / deviations[j], 0)),
    loss,
    rowsUsed: rows.length,
    accuracy: round(correct / x.length),
  };
}

function sigmoid(z: number) {
  return 1 / (1 + Math.exp(-z));
}

function dot(a: number[], b: number[]) {
  return a.reduce((sum, value, i) => sum + value * b[i], 0);
}

function mean(values: number[]) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stdDev(values: number[], average: number) {
  return Math.sqrt(values.reduce((sum, v) => sum + (v - average) ** 2, 0) / values.length);
}

function round(value: number) {
  return Math.round(value * 1e6) / 1e6;
}
