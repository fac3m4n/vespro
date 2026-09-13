import { Sparkles } from "lucide-react";

type Model = {
  featureNames: string[];
  labelName: string;
  weights: number[];
  accuracy: number;
  rowsUsed: number;
  baseRate: number;
};

/**
 * Shown to both sides of the trade, so it lives in one place: the buyer sees what they
 * bought, the owner sees what left their browser. Weights are drawn as signed bars
 * rather than dumped as JSON — the direction of a feature is the only thing anyone can
 * actually read at a glance.
 */
export function ModelWeights({ model, title, stat }: { model: Model; title: string; stat: "accuracy" | "base" }) {
  const max = Math.max(...model.weights.map(Math.abs), 1e-9);

  return (
    <div className="space-y-4 rounded-lg border border-success/30 bg-success/5 p-4">
      <p className="flex items-center gap-2 text-sm font-medium text-success">
        <Sparkles className="size-4" />
        {title}
      </p>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Rows used" value={model.rowsUsed.toLocaleString()} />
        <Stat label="Accuracy" value={`${(model.accuracy * 100).toFixed(1)}%`} />
        {stat === "accuracy" ? (
          <Stat label="Predicting" value={model.labelName} />
        ) : (
          <Stat label="Base rate" value={`${(model.baseRate * 100).toFixed(1)}%`} />
        )}
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Learned weights
        </p>
        <div className="space-y-1.5">
          {model.featureNames.map((name, index) => (
            <WeightBar key={name} name={name} value={model.weights[index]} max={max} />
          ))}
        </div>
      </div>
    </div>
  );
}

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-background px-3 py-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate font-mono text-base font-medium">{value}</p>
    </div>
  );
}

function WeightBar({ name, value, max }: { name: string; value: number; max: number }) {
  const pct = (Math.abs(value) / max) * 50;
  const positive = value >= 0;

  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="w-32 shrink-0 truncate font-mono text-muted-foreground">{name}</span>
      <div className="relative h-4 flex-1 rounded bg-muted">
        <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
        <div
          className={`absolute inset-y-0 rounded ${positive ? "bg-success" : "bg-destructive"}`}
          style={{ width: `${pct}%`, left: positive ? "50%" : `${50 - pct}%` }}
        />
      </div>
      <span className="w-16 shrink-0 text-right font-mono tabular-nums">{value.toFixed(3)}</span>
    </div>
  );
}
