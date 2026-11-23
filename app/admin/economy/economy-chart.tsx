import type { ReactNode } from "react";

export type PlotPoint = { at: number; label: string; value: number };
export type PlotSeries = { label: string; points: PlotPoint[] };

export function EconomyChart({
  title,
  empty,
  dataLabel,
  series,
  bars = false,
  format,
  fixedMax,
  details
}: {
  title: string;
  empty: string;
  dataLabel: string;
  series: PlotSeries[];
  bars?: boolean;
  format: (value: number) => string;
  fixedMax?: number;
  details?: ReactNode;
}) {
  const populated = series.filter(line => line.points.length > 0);
  const points = populated.flatMap(line => line.points);
  if (!points.length) return <p className="yk-econ-empty">{empty}</p>;

  const positions = [...new Set(points.map(point => point.at))].sort(
    (a, b) => a - b
  );
  const first = positions[0];
  const last = positions.at(-1) ?? first;
  const low = Math.min(0, ...points.map(point => point.value));
  const high = fixedMax ?? Math.max(1, ...points.map(point => point.value));
  const span = high - low || 1;
  const x = (at: number) =>
    last === first ? 360 : 74 + (620 * (at - first)) / (last - first);
  const y = (value: number) => 195 - (170 * (value - low)) / span;
  const ticks = [high, (high + low) / 2, low];
  const barWidth = Math.min(30, 540 / positions.length / populated.length);
  const labels = [first, last].filter(
    (item, index, array) => array.indexOf(item) === index
  );
  const labelAt = (at: number) => points.find(point => point.at === at)?.label;

  return (
    <figure className="yk-econ-chart">
      <figcaption className="sr-only">{title}</figcaption>
      <ul className="yk-econ-legend">
        {populated.map((line, index) => (
          <li key={line.label} data-series={index}>
            <span />
            {line.label}
          </li>
        ))}
      </ul>
      <svg role="img" aria-label={title} viewBox="0 0 720 225">
        {ticks.map(tick => (
          <g key={tick} className="yk-econ-axis">
            <line x1="74" x2="694" y1={y(tick)} y2={y(tick)} />
            <text x="68" y={y(tick) + 4} textAnchor="end">
              {format(tick)}
            </text>
          </g>
        ))}
        {labels.map((at, index) => (
          <text
            className="yk-econ-axis"
            key={at}
            x={x(at)}
            y="218"
            textAnchor={
              first === last ? "middle" : index === 0 ? "start" : "end"
            }
          >
            {labelAt(at)}
          </text>
        ))}
        {populated.map((line, index) => (
          <g key={line.label} data-series={index}>
            {bars ? (
              line.points.map(point => (
                <rect
                  key={point.at}
                  x={x(point.at) + (index - populated.length / 2) * barWidth}
                  y={Math.min(y(0), y(point.value))}
                  width={Math.max(0.8, barWidth - 1)}
                  height={Math.abs(y(0) - y(point.value))}
                  rx="2"
                >
                  <title>
                    {[point.label, line.label, format(point.value)].join(" · ")}
                  </title>
                </rect>
              ))
            ) : (
              <>
                <polyline
                  points={line.points
                    .map(point => x(point.at) + "," + y(point.value))
                    .join(" ")}
                  fill="none"
                  strokeWidth="2.5"
                  vectorEffect="non-scaling-stroke"
                />
                {line.points.length <= 120 &&
                  line.points.map(point => (
                    <circle
                      key={point.at}
                      cx={x(point.at)}
                      cy={y(point.value)}
                      r="3"
                    >
                      <title>
                        {[point.label, line.label, format(point.value)].join(
                          " · "
                        )}
                      </title>
                    </circle>
                  ))}
              </>
            )}
          </g>
        ))}
      </svg>
      {details && (
        <details className="yk-econ-details">
          <summary>{dataLabel}</summary>
          {details}
        </details>
      )}
    </figure>
  );
}
