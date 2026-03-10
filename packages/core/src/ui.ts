import type { QueueTelemetry } from './plugin.ts';

export interface UiSchema {
  version: number;
  pages: UiPage[];
  widgets: UiWidget[];
}

export interface UiPage {
  id: string;
  title: string;
  widgetIds: string[];
  /**
   * Явная раскладка виджетов по строкам.
   * Если задано, renderer использует этот порядок/группировку вместо "по одному виджету в строку".
   */
  widgetRows?: string[][];
}

export interface UiLineChartWidget {
  kind: 'line-chart';
  id: string;
  title: string;
  streamIds: string[];
  height?: number;
  timeWindowMs?: number;
}

/**
 * Промежуточный schema-слой для графиков.
 *
 * Важно: это не ECharts-конфиг, а библиотечно-независимое описание.
 * Конкретный renderer (canvas/echarts) будет маппить эти поля в свой backend.
 */
export interface UiChartWidget {
  kind: 'chart';
  id: string;
  title: string;
  series: UiChartSeries[];
  height?: number;
  timeWindowMs?: number;
  showLegend?: boolean;
  renderer?: 'canvas' | 'echarts';
  yAxis?: UiChartAxisConfig;
}

export interface UiChartAxisConfig {
  label?: string;
  min?: number;
  max?: number;
}

interface UiChartSeriesBase {
  id?: string;
  /** Идентификатор UI-стрима (`UiStreamDeclaration.streamId`) */
  streamId: string;
  label?: string;
  color?: string;
  alpha?: number;
}

export interface UiChartLineSeries extends UiChartSeriesBase {
  type: 'line';
  lineWidth?: number;
  lineStyle?: 'solid' | 'dashed' | 'dotted';
  fill?: boolean;
  fillAlpha?: number;
}

export interface UiChartScatterSeries extends UiChartSeriesBase {
  type: 'scatter';
  size?: number;
  marker?: 'circle' | 'rect' | 'triangle' | 'diamond';
}

/**
 * Интервальная серия поверх label-stream.
 * Предполагается, что `streamId` указывает на поток меток, а не обычный сигнал.
 */
export interface UiChartIntervalSeries extends UiChartSeriesBase {
  type: 'interval';
  startLabel: number;
  endLabel: number;
}

export type UiChartSeries = UiChartLineSeries | UiChartScatterSeries | UiChartIntervalSeries;

export interface UiStatusWidget {
  kind: 'status';
  id: string;
  title: string;
  flagKeys: string[];
}

export interface UiControlsWidget {
  kind: 'controls';
  id: string;
  title: string;
  controls: UiControlAction[];
}

export interface UiTelemetryWidget {
  kind: 'telemetry';
  id: string;
  title: string;
}

export type UiWidget = UiLineChartWidget | UiChartWidget | UiStatusWidget | UiControlsWidget | UiTelemetryWidget;

export interface UiControlAction {
  id: string;
  label?: string;
  commandType?: string;
  payload?: Record<string, unknown>;
  disabled?: boolean;
  isLoading?: boolean;
  visible?: boolean;
  hidden?: boolean;
  variants?: UiControlVariant[];
  kind: 'button';
}

export interface UiControlVariant {
  when?: UiControlWhen;
  label?: string;
  commandType?: string;
  payload?: Record<string, unknown>;
  disabled?: boolean;
  isLoading?: boolean;
  visible?: boolean;
  hidden?: boolean;
}

export type UiControlWhen = UiControlWhenEq | UiControlWhenAnd | UiControlWhenOr | UiControlWhenNot;

export interface UiControlWhenEq {
  flag: string;
  eq: UiFlagValue;
}

export interface UiControlWhenAnd {
  and: UiControlWhen[];
}

export interface UiControlWhenOr {
  or: UiControlWhen[];
}

export interface UiControlWhenNot {
  not: UiControlWhen;
}

export interface UiStreamDeclaration {
  streamId: string;
  numericId: number;
  label: string;
  channelId: string;
  sampleFormat: 'f32' | 'f64' | 'i16';
  frameKind: 'uniform-signal-batch' | 'irregular-signal-batch' | 'label-batch';
  units?: string;
  sampleRateHz?: number;
  color?: string;
}

export type UiFlagValue = string | number | boolean | null;
export type UiFlagSnapshot = Record<string, UiFlagValue>;
export type UiFlagPatch = Record<string, UiFlagValue>;

export interface UiSchemaPatch {
  schema: UiSchema;
}

export interface UiSessionClockInfo {
  /**
   * Текущий домен времени для потоковых данных в UI.
   * Для `v1` фиксируем `session`: миллисекунды от старта сессии.
   */
  timeDomain: 'session';
  /**
   * Абсолютное время старта сессии (wall-clock) только для метаданных/отчетов.
   */
  sessionStartWallMs: number;
}

export type UiControlMessage =
  | { type: 'ui.init'; sessionId: string; schema: UiSchema; streams: UiStreamDeclaration[]; flags: UiFlagSnapshot; clock: UiSessionClockInfo }
  | { type: 'ui.schema.patch'; patch: UiSchemaPatch }
  | { type: 'ui.flags.patch'; patch: UiFlagPatch; version: number }
  | { type: 'ui.stream.declare'; stream: UiStreamDeclaration }
  | { type: 'ui.stream.drop'; streamId: string; reason: string }
  | { type: 'ui.telemetry'; queues: QueueTelemetry[]; dropped: number }
  | { type: 'ui.error'; code: string; message: string; pluginId?: string };

export interface UiCommandMessage {
  type: 'ui.command';
  eventType: string;
  payload?: Record<string, unknown>;
  correlationId?: string;
}

export interface UiClientConnectedPayload {
  clientId: string;
}

export interface UiClientDisconnectedPayload {
  clientId: string;
}

export interface UiControlOutPayload {
  clientId?: string;
  message: UiControlMessage;
}

export interface UiBinaryOutPayload {
  clientId?: string;
  data: ArrayBuffer;
}

export interface RuntimeTelemetrySnapshotPayload {
  queues: QueueTelemetry[];
  dropped: number;
}
