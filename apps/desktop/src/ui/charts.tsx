import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { locale, t } from "./i18n";
import type { TimeAxis } from "./analytics";

export type LineSeries = { key: string; label: string; color: string; values: number[] };

/** Rounds a maximum up to 1/2/5 × 10^n so gridlines land on readable values. */
function niceMax(value: number) {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 5, 10].find((candidate) => candidate * power >= value)!;
  return step * power;
}

/** Measured content box of an element, so charts follow their (resizable) container. */
function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 600, height: 190 });
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    setSize({ width: node.clientWidth || 600, height: node.clientHeight || 190 });
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width || 600, height: entry.contentRect.height || 190 }));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}

function timeLabel(time: number, axis: TimeAxis) {
  const date = new Date(time);
  return axis.end - axis.start > 20 * 60 * 60_000
    ? date.toLocaleString(locale(), { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : date.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
}

/** Multi-series time line chart with a crosshair tooltip; one shared y-axis, never two. */
export function LineChart({ series, axis, format, unit, emptyText }: { series: LineSeries[]; axis: TimeAxis; format: (value: number) => string; unit: string; emptyText: string }) {
  const [frame, size] = useSize<HTMLDivElement>();
  const width = size.width;
  const height = Math.max(110, size.height);
  const [hover, setHover] = useState<number | null>(null);
  const visible = series.filter((line) => line.values.some(Boolean));
  const margin = { top: 12, right: 14, bottom: 24, left: 44 };
  const plotWidth = Math.max(60, width - margin.left - margin.right);
  const plotHeight = height - margin.top - margin.bottom;
  const max = niceMax(Math.max(0, ...visible.flatMap((line) => line.values)));
  const x = (index: number) => margin.left + (axis.buckets === 1 ? plotWidth / 2 : (index / (axis.buckets - 1)) * plotWidth);
  const y = (value: number) => margin.top + plotHeight - (value / max) * plotHeight;
  const ticks = [0, max / 2, max];
  const bucketStart = (index: number) => axis.start + index * axis.bucketMs;

  function onMove(event: React.PointerEvent<SVGRectElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - bounds.left) / Math.max(1, bounds.width);
    setHover(Math.max(0, Math.min(axis.buckets - 1, Math.round(ratio * (axis.buckets - 1)))));
  }

  const tooltipRows = hover === null ? [] : visible.map((line) => ({ line, value: line.values[hover] })).sort((a, b) => b.value - a.value);
  const tooltipLeft = hover === null ? 0 : Math.min(width - 210, Math.max(0, x(hover) + 12));

  return <div className="line-chart">
    {visible.length > 1 && <div className="chart-legend-row">{visible.map((line) => <span key={line.key}><i style={{ background: line.color }} />{line.label}<b>{format(line.values.reduce((sum, value) => sum + value, 0))}</b></span>)}</div>}
    <div className="line-chart-plot" ref={frame}>
    {visible.length ? <svg width={width} height={height} role="img" aria-label={t(`${unit} par tranche de temps`, `${unit} per time slot`)}>
      {ticks.map((tick) => <g key={tick}><line className="chart-gridline" x1={margin.left} x2={margin.left + plotWidth} y1={y(tick)} y2={y(tick)} /><text className="chart-axis-label" x={margin.left - 7} y={y(tick)} textAnchor="end" dominantBaseline="middle">{format(tick)}</text></g>)}
      {[0, Math.floor((axis.buckets - 1) / 2), axis.buckets - 1].map((index) => <text key={index} className="chart-axis-label" x={x(index)} y={height - 6} textAnchor={index === 0 ? "start" : index === axis.buckets - 1 ? "end" : "middle"}>{index === axis.buckets - 1 ? t("maintenant", "now") : timeLabel(bucketStart(index), axis)}</text>)}
      {visible.map((line) => <polyline key={line.key} className="chart-line" points={line.values.map((value, index) => `${x(index)},${y(value)}`).join(" ")} style={{ stroke: line.color }} />)}
      {hover !== null && <g className="chart-crosshair"><line x1={x(hover)} x2={x(hover)} y1={margin.top} y2={margin.top + plotHeight} />{visible.map((line) => <circle key={line.key} cx={x(hover)} cy={y(line.values[hover])} r={4} style={{ fill: line.color }} />)}</g>}
      <rect className="chart-hit" x={margin.left} y={margin.top} width={plotWidth} height={plotHeight} onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
    </svg> : <div className="chart-empty" style={{ height }}>{emptyText}</div>}
    {hover !== null && visible.length > 0 && <div className="chart-tooltip" style={{ left: tooltipLeft, top: 8 }} role="status">
      <b>{timeLabel(bucketStart(hover), axis)} → {timeLabel(bucketStart(hover) + axis.bucketMs, axis)}</b>
      {tooltipRows.map(({ line, value }) => <span key={line.key}><i style={{ background: line.color }} />{line.label}<em>{format(value)} {unit}</em></span>)}
    </div>}
    </div>
    {visible.length > 0 && <table className="sr-only"><caption>{t(`${unit} par tranche`, `${unit} per slot`)}</caption><thead><tr><th>{t("Début", "Start")}</th>{visible.map((line) => <th key={line.key}>{line.label}</th>)}</tr></thead><tbody>{Array.from({ length: axis.buckets }, (_, index) => <tr key={index}><td>{timeLabel(bucketStart(index), axis)}</td>{visible.map((line) => <td key={line.key}>{line.values[index]}</td>)}</tr>)}</tbody></table>}
  </div>;
}

export type BarSegment = { value: number; color: string; label: string; pattern?: boolean };
export type BarRow = { key: string; label: ReactNode; title: string; segments: BarSegment[]; valueLabel: string; marker?: string };

/** Horizontal bars with stacked segments, a direct value label and a per-row hover tooltip. */
export function BarList({ rows, legend, emptyText, format }: { rows: BarRow[]; legend?: Array<{ label: string; color: string; pattern?: boolean }>; emptyText: string; format: (value: number) => string }) {
  const [hover, setHover] = useState<{ row: BarRow; top: number } | null>(null);
  const max = Math.max(1, ...rows.map((row) => row.segments.reduce((sum, segment) => sum + segment.value, 0)));
  if (!rows.length) return <div className="chart-empty compact">{emptyText}</div>;
  return <div className="bar-list" onPointerLeave={() => setHover(null)}>
    {legend && <div className="chart-legend-row compact">{legend.map((item) => <span key={item.label}><i className={item.pattern ? "patterned" : ""} style={{ background: item.color }} />{item.label}</span>)}</div>}
    {rows.map((row) => <div className="bar-row" key={row.key} onPointerEnter={(event) => setHover({ row, top: (event.currentTarget as HTMLElement).offsetTop })}>
      <span className="bar-label" title={row.title}>{row.marker && <i className="bar-marker" style={{ background: row.marker }} />}{row.label}</span>
      <span className="bar-track">{row.segments.filter((segment) => segment.value > 0).map((segment, index) => <span key={index} className={`bar-segment ${segment.pattern ? "patterned" : ""}`} style={{ width: `${(segment.value / max) * 100}%`, "--segment-color": segment.color } as CSSProperties} />)}</span>
      <span className="bar-value">{row.valueLabel}</span>
    </div>)}
    {hover && <div className="chart-tooltip bar-tooltip" style={{ top: hover.top + 26 }} role="status"><b>{hover.row.title}</b>{hover.row.segments.map((segment) => <span key={segment.label}><i className={segment.pattern ? "patterned" : ""} style={{ background: segment.color }} />{segment.label}<em>{format(segment.value)}</em></span>)}</div>}
  </div>;
}
