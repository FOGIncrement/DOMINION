interface SparklineProps {
  values: number[];
  accentColor: string;
  width?: number;
  height?: number;
}

export default function Sparkline({ values, accentColor, width = 200, height = 40 }: SparklineProps) {
  if (values.length < 2) {
    return <svg width={width} height={height} aria-hidden="true" />;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const padY = 4;

  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = height - padY - ((v - min) / range) * (height - padY * 2);
    return [x, y] as const;
  });

  const path = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [lastX, lastY] = points[points.length - 1];

  return (
    <svg width={width} height={height} role="img" aria-label="Recent price trend">
      <path d={path} fill="none" stroke="var(--text-muted)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lastX} cy={lastY} r={4} fill={accentColor} stroke="var(--surface-1)" strokeWidth={2} />
    </svg>
  );
}
