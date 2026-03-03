import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts/core';
import type { ECharts } from 'echarts/core';
import type { EChartsOption, SeriesOption } from 'echarts';
import { GridComponent, LegendComponent, MarkAreaComponent, TooltipComponent } from 'echarts/components';
import { LineChart, ScatterChart } from 'echarts/charts';
import { CanvasRenderer } from 'echarts/renderers';
import { ClientRuntime, type StreamWindowData } from '@sensync2/client-runtime';
import type {
  UiChartSeries,
  UiChartWidget,
  UiControlAction,
  UiControlWhen,
  UiControlsWidget,
  UiLineChartWidget,
  UiStatusWidget,
  UiTelemetryWidget,
  UiWidget,
} from '@sensync2/core';
import { ElectronBridgeTransport } from './electronTransport.ts';

echarts.use([GridComponent, LegendComponent, MarkAreaComponent, TooltipComponent, LineChart, ScatterChart, CanvasRenderer]);

const runtimeSingleton = new ClientRuntime(new ElectronBridgeTransport());

function useRuntimeSnapshot() {
  const [rev, setRev] = useState(0);

  useEffect(() => runtimeSingleton.onUpdate(() => setRev((r) => r + 1)), []);
  useEffect(() => {
    void runtimeSingleton.connect();
    return () => {
      void runtimeSingleton.disconnect();
    };
  }, []);

  return { snapshot: runtimeSingleton.getSnapshot(), rev };
}

interface ResolvedControlAction {
  label: string;
  commandType: string | undefined;
  payload: Record<string, unknown> | undefined;
  disabled: boolean;
  isLoading: boolean;
  hidden: boolean;
}

type UiFlagsMap = Record<string, unknown>;
type CompiledWhenPredicate = (flags: UiFlagsMap) => boolean;
type CompiledControlResolver = (flags: UiFlagsMap) => ResolvedControlAction;

// Кэшируем скомпилированные резолверы на уровне объекта схемы, чтобы не пересобирать их на каждом рендере.
const compiledControlResolvers = new WeakMap<UiControlAction, CompiledControlResolver>();

function compileWhen(when?: UiControlWhen): CompiledWhenPredicate {
  if (!when) {
    return () => true;
  }

  if ('and' in when) {
    const parts = when.and.map((part) => compileWhen(part));
    return (flags) => parts.every((part) => part(flags));
  }

  if ('or' in when) {
    const parts = when.or.map((part) => compileWhen(part));
    return (flags) => parts.some((part) => part(flags));
  }

  if ('not' in when) {
    const part = compileWhen(when.not);
    return (flags) => !part(flags);
  }

  return (flags) => (flags[when.flag] ?? null) === when.eq;
}

function compileControlAction(control: UiControlAction): CompiledControlResolver {
  const compiledVariants = (control.variants ?? []).map((variant) => ({
    variant,
    matches: compileWhen(variant.when),
  }));

  return (flags) => {
    const matchedVariant = compiledVariants.find((entry) => entry.matches(flags))?.variant;

    // Сначала берем базовые поля кнопки, затем точечно перекрываем их активным вариантом.
    const merged = {
      label: control.label,
      commandType: control.commandType,
      payload: control.payload,
      disabled: control.disabled,
      isLoading: control.isLoading,
      visible: control.visible,
      hidden: control.hidden,
      ...matchedVariant,
    };

    const hasCommand = typeof merged.commandType === 'string' && merged.commandType.length > 0;
    // `hidden` имеет приоритет над `visible`, чтобы конфликтующие схемы вели себя предсказуемо.
    const hidden = Boolean(merged.hidden) || merged.visible === false;
    return {
      label: merged.label ?? control.id,
      commandType: hasCommand ? merged.commandType : undefined,
      payload: merged.payload,
      // Если у варианта нет команды (например, состояние "подключение"), кнопку блокируем автоматически.
      disabled: Boolean(merged.disabled) || !hasCommand,
      isLoading: Boolean(merged.isLoading),
      hidden,
    };
  };
}

function resolveControlAction(control: UiControlAction, flags: UiFlagsMap): ResolvedControlAction {
  let resolver = compiledControlResolvers.get(control);
  if (!resolver) {
    resolver = compileControlAction(control);
    compiledControlResolvers.set(control, resolver);
  }
  return resolver(flags);
}

function ControlsWidget({ widget, flags }: { widget: UiControlsWidget; flags: Record<string, unknown> }) {
  return (
    <section style={panelStyle}>
      <h3 style={titleStyle}>{widget.title}</h3>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {widget.controls.map((control) => {
          const resolved = resolveControlAction(control, flags);
          if (resolved.hidden) {
            return null;
          }
          return (
            <button
              key={control.id}
              type="button"
              disabled={resolved.disabled}
              aria-busy={resolved.isLoading || undefined}
              onClick={() => {
                if (!resolved.commandType) return;
                void runtimeSingleton.sendCommand(resolved.commandType, resolved.payload);
              }}
              style={{
                border: '1px solid var(--border)',
                background: 'linear-gradient(180deg, #1f2937 0%, #161b22 100%)',
                color: 'var(--text)',
                padding: '8px 10px',
                borderRadius: 10,
                cursor: resolved.disabled ? 'not-allowed' : resolved.isLoading ? 'wait' : 'pointer',
                opacity: resolved.disabled ? 0.7 : 1,
              }}
            >
              {resolved.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function StatusWidget({ widget, flags }: { widget: UiStatusWidget; flags: Record<string, unknown> }) {
  return (
    <section style={panelStyle}>
      <h3 style={titleStyle}>{widget.title}</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
        {widget.flagKeys.map((key) => {
          const value = flags[key];
          const text = typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value ?? '—');
          const color = text.includes('connected') || text === 'true' ? 'var(--ok)' : text.includes('failed') ? 'var(--bad)' : 'var(--muted)';
          return (
            <div key={key} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 8, background: '#11161d' }}>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{key}</div>
              <div style={{ fontWeight: 700, color }}>{text}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function TelemetryWidget({ widget, telemetry }: { widget: UiTelemetryWidget; telemetry: ReturnType<typeof runtimeSingleton.getSnapshot>['telemetry'] }) {
  return (
    <section style={panelStyle}>
      <h3 style={titleStyle}>{widget.title}</h3>
      <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>Dropped total: {telemetry?.dropped ?? 0}</div>
      <div style={{ display: 'grid', gap: 6 }}>
        {(telemetry?.queues ?? []).map((q) => (
          <div key={q.pluginId} style={{ display: 'grid', gridTemplateColumns: '220px repeat(5, minmax(70px, auto))', gap: 8, fontSize: 12 }}>
            <span>{q.pluginId}</span>
            <span>c:{q.controlDepth}</span>
            <span>d:{q.dataDepth}</span>
            <span>drop:{q.dropped}</span>
            <span>coal:{q.coalesced}</span>
            <span>{q.avgHandlerMs.toFixed(2)}ms</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function LineChartWidget({ widget }: { widget: UiLineChartWidget }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamIds = widget.streamIds;
  const timeWindowMs = widget.timeWindowMs ?? 10_000;

  useEffect(() => {
    let raf = 0;
    const colors = ['#58a6ff', '#3fb950', '#f85149', '#d29922', '#a371f7', '#ffa657'];

    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) {
        raf = requestAnimationFrame(draw);
        return;
      }
      const rect = canvas.getBoundingClientRect();
      if (canvas.width !== Math.floor(rect.width * devicePixelRatio) || canvas.height !== Math.floor(rect.height * devicePixelRatio)) {
        canvas.width = Math.max(1, Math.floor(rect.width * devicePixelRatio));
        canvas.height = Math.max(1, Math.floor(rect.height * devicePixelRatio));
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        raf = requestAnimationFrame(draw);
        return;
      }
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#0f141b';
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = '#253041';
      ctx.lineWidth = 1;
      for (let i = 1; i < 4; i += 1) {
        const y = (h / 4) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      const windows = streamIds.map((streamId) => runtimeSingleton.getVisibleWindow(streamId, timeWindowMs));
      let maxT = 0;
      let hasAnyTime = false;
      for (const win of windows) {
        if (win.length === 0) continue;
        const last = win.x[win.length - 1]!;
        if (!hasAnyTime || last > maxT) maxT = last;
        hasAnyTime = true;
      }
      if (!hasAnyTime) {
        maxT = timeWindowMs;
      }
      const minT = Math.max(0, maxT - timeWindowMs);

      let yMin = -1.5;
      let yMax = 1.5;

      for (const win of windows) {
        for (let i = 0; i < win.length; i += 1) {
          const v = win.y[i]!;
          if (v < yMin) yMin = v;
          if (v > yMax) yMax = v;
        }
      }
      if (Math.abs(yMax - yMin) < 1e-6) {
        yMin -= 1;
        yMax += 1;
      }

      const scaleX = (t: number) => ((t - minT) / (maxT - minT)) * w;
      const scaleY = (v: number) => h - ((v - yMin) / (yMax - yMin)) * h;

      windows.forEach((win, idx) => {
        if (win.length === 0) return;
        ctx.strokeStyle = colors[idx % colors.length] ?? '#58a6ff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < win.length; i += 1) {
          const x = scaleX(win.x[i]!);
          const y = scaleY(win.y[i]!);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      });

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [streamIds, timeWindowMs]);

  return (
    <section style={panelStyle}>
      <h3 style={titleStyle}>{widget.title}</h3>
      <div style={{ position: 'relative' }}>
        <canvas ref={canvasRef} style={{ width: '100%', height: widget.height ?? 260, display: 'block', borderRadius: 10, border: '1px solid var(--border)' }} />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>
        {streamIds.map((id) => <span key={id}>{id}</span>)}
      </div>
    </section>
  );
}

function chartSeriesKey(series: UiChartSeries): string {
  return series.id ?? `${series.type}:${series.streamId}`;
}

function chartSeriesLabel(series: UiChartSeries): string {
  return series.label ?? series.streamId;
}

function formatSessionAxisLabel(valueMs: number): string {
  const totalSec = Math.max(0, Math.floor(valueMs / 1000));
  const mm = Math.floor(totalSec / 60);
  const ss = totalSec % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function lineDashForStyle(style: 'solid' | 'dashed' | 'dotted' | undefined): number[] {
  if (style === 'dashed') return [8, 5];
  if (style === 'dotted') return [2, 4];
  return [];
}

function drawScatterMarker(
  ctx: CanvasRenderingContext2D,
  marker: 'circle' | 'rect' | 'triangle' | 'diamond' | undefined,
  x: number,
  y: number,
  size: number,
): void {
  const r = Math.max(1, size / 2);
  const shape = marker ?? 'circle';
  if (shape === 'rect') {
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    return;
  }
  if (shape === 'triangle') {
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r, y + r);
    ctx.lineTo(x - r, y + r);
    ctx.closePath();
    ctx.fill();
    return;
  }
  if (shape === 'diamond') {
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r, y);
    ctx.lineTo(x, y + r);
    ctx.lineTo(x - r, y);
    ctx.closePath();
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function ChartWidgetCanvas({ widget }: { widget: UiChartWidget }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const timeWindowMs = widget.timeWindowMs ?? 10_000;

  useEffect(() => {
    let raf = 0;
    const fallbackPalette = ['#58a6ff', '#3fb950', '#f85149', '#d29922', '#a371f7', '#ffa657', '#79c0ff'];

    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) {
        raf = requestAnimationFrame(draw);
        return;
      }

      const rect = canvas.getBoundingClientRect();
      if (canvas.width !== Math.floor(rect.width * devicePixelRatio) || canvas.height !== Math.floor(rect.height * devicePixelRatio)) {
        canvas.width = Math.max(1, Math.floor(rect.width * devicePixelRatio));
        canvas.height = Math.max(1, Math.floor(rect.height * devicePixelRatio));
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        raf = requestAnimationFrame(draw);
        return;
      }

      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#0f141b';
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = '#253041';
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      for (let i = 1; i < 4; i += 1) {
        const y = (h / 4) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      // Читаем данные по уникальным streamId один раз за кадр, даже если серий несколько.
      const windowsByStream = new Map<string, StreamWindowData>();
      for (const series of widget.series) {
        if (!windowsByStream.has(series.streamId)) {
          windowsByStream.set(series.streamId, runtimeSingleton.getVisibleWindow(series.streamId, timeWindowMs));
        }
      }

      let maxT = 0;
      let hasAnyTime = false;
      for (const win of windowsByStream.values()) {
        if (win.length === 0) continue;
        const last = win.x[win.length - 1]!;
        if (!hasAnyTime || last > maxT) maxT = last;
        hasAnyTime = true;
      }
      if (!hasAnyTime) {
        maxT = timeWindowMs;
      }
      const minT = Math.max(0, maxT - timeWindowMs);

      let yMin = widget.yAxis?.min;
      let yMax = widget.yAxis?.max;
      if (yMin === undefined || yMax === undefined) {
        let autoMin = Number.POSITIVE_INFINITY;
        let autoMax = Number.NEGATIVE_INFINITY;
        for (const series of widget.series) {
          if (series.type === 'interval') continue;
          const win = windowsByStream.get(series.streamId);
          if (!win) continue;
          for (let i = 0; i < win.length; i += 1) {
            const v = win.y[i]!;
            if (v < autoMin) autoMin = v;
            if (v > autoMax) autoMax = v;
          }
        }
        if (!Number.isFinite(autoMin) || !Number.isFinite(autoMax)) {
          autoMin = -1;
          autoMax = 1;
        }
        yMin ??= autoMin;
        yMax ??= autoMax;
      }

      if (Math.abs(yMax - yMin) < 1e-6) {
        yMin -= 1;
        yMax += 1;
      }

      const scaleX = (t: number) => ((t - minT) / (maxT - minT)) * w;
      const scaleY = (v: number) => h - ((v - yMin) / (yMax - yMin)) * h;

      // Рисуем interval-серии первыми как фоновые полосы.
      widget.series.forEach((series, idx) => {
        if (series.type !== 'interval') return;
        const win = windowsByStream.get(series.streamId);
        if (!win || win.length === 0) return;

        const fillColor = series.color ?? fallbackPalette[idx % fallbackPalette.length] ?? '#58a6ff';
        ctx.save();
        ctx.fillStyle = fillColor;
        ctx.globalAlpha = series.alpha ?? 0.18;

        let openStart: number | null = null;
        for (let i = 0; i < win.length; i += 1) {
          const label = Math.round(win.y[i]!);
          const t = win.x[i]!;
          if (label === series.startLabel && openStart === null) {
            openStart = t;
            continue;
          }
          if (label === series.endLabel && openStart !== null) {
            const x1 = Math.max(0, Math.min(w, scaleX(openStart)));
            const x2 = Math.max(0, Math.min(w, scaleX(t)));
            if (x2 > x1) {
              ctx.fillRect(x1, 0, x2 - x1, h);
            }
            openStart = null;
          }
        }

        // Если интервал не закрыт, тянем его до правой границы окна.
        if (openStart !== null) {
          const x1 = Math.max(0, Math.min(w, scaleX(openStart)));
          const x2 = w;
          if (x2 > x1) {
            ctx.fillRect(x1, 0, x2 - x1, h);
          }
        }

        ctx.restore();
      });

      widget.series.forEach((series, idx) => {
        if (series.type === 'interval') return;
        const win = windowsByStream.get(series.streamId);
        if (!win || win.length === 0) return;

        const color = series.color ?? fallbackPalette[idx % fallbackPalette.length] ?? '#58a6ff';
        if (series.type === 'line') {
          if (series.fill && win.length > 0) {
            ctx.save();
            ctx.fillStyle = color;
            ctx.globalAlpha = series.fillAlpha ?? 0.18;
            ctx.beginPath();
            const x0 = scaleX(win.x[0]!);
            const baselineY = scaleY(Math.max(yMin, Math.min(0, yMax)));
            ctx.moveTo(x0, baselineY);
            for (let i = 0; i < win.length; i += 1) {
              ctx.lineTo(scaleX(win.x[i]!), scaleY(win.y[i]!));
            }
            ctx.lineTo(scaleX(win.x[win.length - 1]!), baselineY);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
          }

          ctx.save();
          ctx.strokeStyle = color;
          ctx.globalAlpha = series.alpha ?? 1;
          ctx.lineWidth = series.lineWidth ?? 2;
          ctx.setLineDash(lineDashForStyle(series.lineStyle));
          ctx.beginPath();
          for (let i = 0; i < win.length; i += 1) {
            const x = scaleX(win.x[i]!);
            const y = scaleY(win.y[i]!);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
          ctx.restore();
          return;
        }

        // `scatter`
        ctx.save();
        ctx.fillStyle = color;
        ctx.globalAlpha = series.alpha ?? 1;
        for (let i = 0; i < win.length; i += 1) {
          drawScatterMarker(ctx, series.marker, scaleX(win.x[i]!), scaleY(win.y[i]!), series.size ?? 6);
        }
        ctx.restore();
      });

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [widget.series, widget.timeWindowMs, widget.yAxis?.min, widget.yAxis?.max]);

  return (
    <section style={panelStyle}>
      <h3 style={titleStyle}>{widget.title}</h3>
      <div style={{ position: 'relative' }}>
        <canvas ref={canvasRef} style={{ width: '100%', height: widget.height ?? 260, display: 'block', borderRadius: 10, border: '1px solid var(--border)' }} />
      </div>
      <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {widget.series.map((series) => (
          <span key={chartSeriesKey(series)}>
            {chartSeriesLabel(series)} ({series.type})
          </span>
        ))}
      </div>
    </section>
  );
}

function buildIntervalAreas(
  win: StreamWindowData,
  startLabel: number,
  endLabel: number,
  xMaxMs: number,
  color: string,
  alpha: number,
): Array<[Record<string, unknown>, Record<string, unknown>]> {
  const areas: Array<[Record<string, unknown>, Record<string, unknown>]> = [];
  let openStartMs: number | null = null;

  for (let i = 0; i < win.length; i += 1) {
    const label = Math.round(win.y[i]!);
    const tMs = win.x[i]!;
    if (label === startLabel && openStartMs === null) {
      openStartMs = tMs;
      continue;
    }
    if (label === endLabel && openStartMs !== null) {
      areas.push([
        {
          xAxis: openStartMs,
          itemStyle: {
            color,
            opacity: alpha,
          },
        },
        { xAxis: tMs },
      ]);
      openStartMs = null;
    }
  }

  if (openStartMs !== null) {
    areas.push([
      {
        xAxis: openStartMs,
        itemStyle: {
          color,
          opacity: alpha,
        },
      },
      { xAxis: xMaxMs },
    ]);
  }

  return areas;
}

type MonotonicDebugStatus = 'OK' | 'WRONG';

interface MonotonicDebugSnapshot {
  lastStatus: MonotonicDebugStatus;
  lastLoggedAtMs: number;
}

const monotonicDebugByStream = new Map<string, MonotonicDebugSnapshot>();

function logMonotonicTimeArrayCheck(streamId: string, x: Float64Array, length: number): void {
  if (length < 2) return;

  let status: MonotonicDebugStatus = 'OK';
  let wrongIndex = -1;
  let wrongPrev = 0;
  let wrongCurr = 0;

  for (let i = 1; i < length; i += 1) {
    const prev = x[i - 1]!;
    const curr = x[i]!;
    // Проверяем строгую монотонность: каждое следующее значение времени должно быть больше предыдущего.
    if (!(curr > prev)) {
      status = 'WRONG';
      wrongIndex = i;
      wrongPrev = prev;
      wrongCurr = curr;
      break;
    }
  }

  const now = Date.now();
  const prevSnapshot = monotonicDebugByStream.get(streamId);
  const shouldLog = !prevSnapshot
    || prevSnapshot.lastStatus !== status
    || (now - prevSnapshot.lastLoggedAtMs) >= 1000;

  monotonicDebugByStream.set(streamId, { lastStatus: status, lastLoggedAtMs: now });
  if (!shouldLog) return;

  if (status === 'OK') {
    console.log(`[TS_MONO] ${streamId}: OK`, {
      length,
      first: x[0],
      last: x[length - 1],
    });
    return;
  }

  console.log(`[TS_MONO] ${streamId}: WRONG`, {
    length,
    wrongIndex,
    prev: wrongPrev,
    curr: wrongCurr,
    first: x[0],
    last: x[length - 1],
  });
}

function buildChartWindows(widget: UiChartWidget, timeWindowMs: number): Map<string, StreamWindowData> {
  const windowsByStream = new Map<string, StreamWindowData>();
  for (const series of widget.series) {
    if (!windowsByStream.has(series.streamId)) {
      const win = runtimeSingleton.getVisibleWindow(series.streamId, timeWindowMs);
      windowsByStream.set(series.streamId, win);
      // Диагностику включаем только для "настоящих" графиковых серий, чтобы label-stream (interval overlay)
      // не давал ложные срабатывания из-за своей специфики обновления.
      if (series.type !== 'interval') {
        logMonotonicTimeArrayCheck(series.streamId, win.x, win.length);
      }
    }
  }
  return windowsByStream;
}

function buildChartYRange(widget: UiChartWidget, windowsByStream: Map<string, StreamWindowData>): { min: number; max: number } {
  let yMin = widget.yAxis?.min;
  let yMax = widget.yAxis?.max;

  if (yMin === undefined || yMax === undefined) {
    let autoMin = Number.POSITIVE_INFINITY;
    let autoMax = Number.NEGATIVE_INFINITY;
    for (const series of widget.series) {
      if (series.type === 'interval') continue;
      const win = windowsByStream.get(series.streamId);
      if (!win) continue;
      for (let i = 0; i < win.length; i += 1) {
        const v = win.y[i]!;
        if (v < autoMin) autoMin = v;
        if (v > autoMax) autoMax = v;
      }
    }
    if (!Number.isFinite(autoMin) || !Number.isFinite(autoMax)) {
      autoMin = -1;
      autoMax = 1;
    }
    yMin ??= autoMin;
    yMax ??= autoMax;
  }

  if (Math.abs(yMax - yMin) < 1e-6) {
    yMin -= 1;
    yMax += 1;
  }

  return { min: yMin, max: yMax };
}

function buildEchartsOption(widget: UiChartWidget, windowsByStream: Map<string, StreamWindowData>): EChartsOption {
  const timeWindowMs = widget.timeWindowMs ?? 10_000;
  let xMaxMs = 0;
  let hasAnyTime = false;
  for (const win of windowsByStream.values()) {
    if (win.length === 0) continue;
    const last = win.x[win.length - 1]!;
    if (!hasAnyTime || last > xMaxMs) xMaxMs = last;
    hasAnyTime = true;
  }
  if (!hasAnyTime) {
    xMaxMs = timeWindowMs;
  }
  const xMinMs = Math.max(0, xMaxMs - timeWindowMs);
  const { min: yMin, max: yMax } = buildChartYRange(widget, windowsByStream);
  const fallbackPalette = ['#58a6ff', '#3fb950', '#f85149', '#d29922', '#a371f7', '#ffa657', '#79c0ff'];

  const seriesOptions: SeriesOption[] = widget.series.map((series, idx) => {
    const color = series.color ?? fallbackPalette[idx % fallbackPalette.length] ?? '#58a6ff';
    const name = chartSeriesLabel(series);
    const id = chartSeriesKey(series);
    const win = windowsByStream.get(series.streamId);

    if (series.type === 'interval') {
      const areas = win
        ? buildIntervalAreas(win, series.startLabel, series.endLabel, xMaxMs, color, series.alpha ?? 0.18)
        : [];
      const intervalSeries: SeriesOption = {
        id,
        name,
        type: 'line',
        data: [],
        animation: false,
        lineStyle: { opacity: 0 },
        itemStyle: { opacity: 0 },
        silent: true,
        markArea: {
          silent: true,
          data: areas,
          animation: false,
        },
        tooltip: { show: false },
      };
      return intervalSeries;
    }

    const points: Array<[number, number]> = [];
    if (win) {
      for (let i = 0; i < win.length; i += 1) {
        points.push([win.x[i]!, win.y[i]!]);
      }
    }

    if (series.type === 'line') {
      const lineSeries: SeriesOption = {
        id,
        name,
        type: 'line',
        data: points,
        animation: false,
        showSymbol: false,
        lineStyle: {
          color,
          width: series.lineWidth ?? 2,
          type: series.lineStyle ?? 'solid',
          opacity: series.alpha ?? 1,
        },
        itemStyle: {
          color,
          opacity: series.alpha ?? 1,
        },
      };
      if (series.fill) {
        lineSeries.areaStyle = {
          color,
          opacity: series.fillAlpha ?? 0.18,
        };
      }
      return lineSeries;
    }

    const scatterSeries: SeriesOption = {
      id,
      name,
      type: 'scatter',
      data: points,
      animation: false,
      symbol: series.marker ?? 'circle',
      symbolSize: series.size ?? 6,
      itemStyle: {
        color,
        opacity: series.alpha ?? 1,
      },
    };
    return scatterSeries;
  });

  const option: EChartsOption = {
    animation: false,
    grid: {
      left: 56,
      right: 16,
      top: widget.showLegend ? 36 : 12,
      bottom: 28,
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'line' },
      // Форматируем кратко, без утечки внутренних полей схемы.
      valueFormatter: (value) => (typeof value === 'number' ? value.toFixed(3) : String(value)),
    },
    ...(widget.showLegend
      ? {
          legend: {
            top: 8,
            textStyle: { color: '#9aa4b2', fontSize: 11 },
          },
        }
      : {}),
    xAxis: {
      // Для высокочастотных потоков (например, 10 кГц, шаг 0.1мс) `time`-ось в ECharts
      // может визуально деградировать из-за квантования/парсинга времени.
      // Используем `value` и храним X как миллисекунды, как это было в старом приложении.
      type: 'value',
      min: xMinMs,
      max: xMaxMs,
      axisLabel: {
        color: '#9aa4b2',
        formatter: (value: number) => formatSessionAxisLabel(value),
      },
      splitLine: { show: false },
      axisLine: { lineStyle: { color: '#253041' } },
    },
    yAxis: {
      type: 'value',
      min: yMin,
      max: yMax,
      nameTextStyle: { color: '#9aa4b2' },
      axisLabel: { color: '#9aa4b2' },
      splitLine: { lineStyle: { color: '#253041' } },
      axisLine: { lineStyle: { color: '#253041' } },
      ...(widget.yAxis?.label !== undefined ? { name: widget.yAxis.label } : {}),
    },
    series: seriesOptions,
  };

  return option;
}

function ChartWidgetEcharts({ widget }: { widget: UiChartWidget }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ECharts | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const existing = echarts.getInstanceByDom(container);
    const chart = existing ?? echarts.init(container, undefined, { renderer: 'canvas' });
    chartRef.current = chart;

    const resizeObserver = new ResizeObserver(() => chart.resize());
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.dispose();
      if (chartRef.current === chart) {
        chartRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    let raf = 0;
    let dirty = true;
    const relevantStreams = new Set(widget.series.map((series) => series.streamId));

    const render = () => {
      const chart = chartRef.current;
      if (!chart) return;
      const timeWindowMs = widget.timeWindowMs ?? 10_000;
      const windowsByStream = buildChartWindows(widget, timeWindowMs);
      const option = buildEchartsOption(widget, windowsByStream);
      chart.setOption(option, {
        replaceMerge: ['series'],
      });
    };

    const unsubStream = runtimeSingleton.onStreamData((streamId) => {
      if (relevantStreams.has(streamId)) {
        dirty = true;
      }
    });

    const loop = () => {
      if (dirty) {
        dirty = false;
        render();
      }
      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      unsubStream();
    };
  }, [widget]);

  return (
    <section style={panelStyle}>
      <h3 style={titleStyle}>{widget.title}</h3>
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: widget.height ?? 260,
          borderRadius: 10,
          border: '1px solid var(--border)',
          background: '#0f141b',
          overflow: 'hidden',
        }}
      />
    </section>
  );
}

function renderWidget(widget: UiWidget, flags: Record<string, unknown>, telemetry: ReturnType<typeof runtimeSingleton.getSnapshot>['telemetry']) {
  if (widget.kind === 'controls') return <ControlsWidget key={widget.id} widget={widget} flags={flags} />;
  if (widget.kind === 'status') return <StatusWidget key={widget.id} widget={widget} flags={flags} />;
  if (widget.kind === 'chart') {
    if (widget.renderer === 'echarts') {
      return <ChartWidgetEcharts key={widget.id} widget={widget} />;
    }
    return <ChartWidgetCanvas key={widget.id} widget={widget} />;
  }
  if (widget.kind === 'line-chart') return <LineChartWidget key={widget.id} widget={widget} />;
  return <TelemetryWidget key={widget.id} widget={widget} telemetry={telemetry} />;
}

const panelStyle: React.CSSProperties = {
  background: 'linear-gradient(180deg, rgba(22,27,34,0.92) 0%, rgba(13,17,23,0.92) 100%)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: 12,
  boxShadow: '0 12px 24px rgba(0,0,0,0.18)',
};

const titleStyle: React.CSSProperties = { margin: '0 0 10px', fontSize: 14, letterSpacing: 0.3 };

export function App() {
  const { snapshot, rev } = useRuntimeSnapshot();
  const page = useMemo(() => snapshot.schema?.pages[0], [snapshot.schema, rev]);
  const widgets = useMemo(() => {
    if (!snapshot.schema || !page) return [];
    const byId = new Map(snapshot.schema.widgets.map((w) => [w.id, w]));
    return page.widgetIds.map((id) => byId.get(id)).filter(Boolean) as UiWidget[];
  }, [snapshot.schema, page, rev]);

  return (
    <div style={{ minHeight: '100%', padding: 16, display: 'grid', gap: 12, alignContent: 'start' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>Sensync2</h1>
          <div style={{ color: 'var(--muted)', fontSize: 12 }}>
            {snapshot.connected ? `connected${snapshot.sessionId ? ` • ${snapshot.sessionId}` : ''}` : 'disconnected'}
          </div>
        </div>
        {snapshot.flags.lastError ? (
          <div style={{ color: 'var(--bad)', fontSize: 12, maxWidth: 420, textAlign: 'right' }}>{String(snapshot.flags.lastError)}</div>
        ) : null}
      </header>

      {!snapshot.schema ? (
        <section style={panelStyle}>
          <h3 style={titleStyle}>Ожидание схемы UI</h3>
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>
            Renderer подключен, ожидаем `ui.init` от `ui-gateway`.
          </div>
        </section>
      ) : (
        widgets.map((widget) => renderWidget(widget, snapshot.flags, snapshot.telemetry))
      )}
    </div>
  );
}
