import type { RuntimeEventInput } from './events.ts';
import type { QueueTelemetry } from './plugin.ts';
import type { SharedUiCommandBoundaryEvent } from './ui-command-boundary.ts';

export type UiCommandEvent = SharedUiCommandBoundaryEvent;
export type UiCommandEventType = UiCommandEvent['type'];
export type UiCommandEventVersion = UiCommandEvent['v'];

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
  commandType?: UiCommandEventType;
  commandVersion?: UiCommandEventVersion;
  payload?: Record<string, unknown>;
  modalForm?: UiModalForm;
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
  commandType?: UiCommandEventType;
  commandVersion?: UiCommandEventVersion;
  payload?: Record<string, unknown>;
  modalForm?: UiModalForm;
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

export interface UiModalForm {
  id: string;
  title: string;
  submitLabel?: string;
  submitEventType: UiCommandEventType;
  submitEventVersion?: UiCommandEventVersion;
  submitPayload?: Record<string, unknown>;
  fields: UiModalFormNode[];
}

export type UiModalFormNode =
  | UiModalFormRow
  | UiModalFormColumn
  | UiModalFormTextInput
  | UiModalFormNumberInput
  | UiModalFormDecimalInput
  | UiModalFormFileInput
  | UiModalFormSelect;

export interface UiModalFormRow {
  kind: 'row';
  children: UiModalFormNode[];
}

export interface UiModalFormColumn {
  kind: 'column';
  children: UiModalFormNode[];
}

interface UiModalFormFieldBase {
  fieldId: string;
  label: string;
  required?: boolean;
}

export interface UiModalFormTextInput extends UiModalFormFieldBase {
  kind: 'textInput';
  defaultValue?: string;
  placeholder?: string;
}

export interface UiModalFormNumberInput extends UiModalFormFieldBase {
  kind: 'numberInput';
  defaultValue?: number;
  min?: number;
  max?: number;
  step?: number;
}

export interface UiModalFormDecimalInput extends UiModalFormFieldBase {
  kind: 'decimalInput';
  defaultValue?: number;
  min?: number;
  max?: number;
  step?: number;
}

export interface UiModalFormFileInput extends UiModalFormFieldBase {
  kind: 'fileInput';
  defaultValue?: string;
  mode: 'existing-file' | 'existing-directory';
}

export interface UiModalFormSelect extends UiModalFormFieldBase {
  kind: 'select';
  sourceId: string;
  defaultValue?: string;
  placeholder?: string;
  mergeSelectedOptionPayload?: boolean;
}

export interface UiFormOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
  payload?: Record<string, unknown>;
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
  | { type: 'ui.form.options.patch'; sourceId: string; options: UiFormOption[] }
  | { type: 'ui.stream.declare'; stream: UiStreamDeclaration }
  | { type: 'ui.stream.drop'; streamId: string; reason: string }
  | { type: 'ui.telemetry'; queues: QueueTelemetry[]; dropped: number; metrics: UiPluginMetric[] }
  | { type: 'ui.warning'; code: string; message: string; pluginId?: string }
  | { type: 'ui.error'; code: string; message: string; pluginId?: string };

export type UiCommandMessage<TEvent extends UiCommandEvent = UiCommandEvent> = TEvent extends UiCommandEvent ? {
  type: 'ui.command';
  eventType: TEvent['type'];
  eventVersion: TEvent['v'];
  payload: TEvent['payload'];
  correlationId?: string;
} : never;

interface CreateUiCommandMessageInputBase {
  correlationId?: string;
}

export interface CreateUiCommandMessageInput<
  TEvent extends UiCommandEvent = UiCommandEvent,
> extends CreateUiCommandMessageInputBase {
  eventType: TEvent['type'];
  eventVersion?: TEvent['v'];
  payload: TEvent['payload'];
}

export interface CreateUiCommandMessageDynamicInput extends CreateUiCommandMessageInputBase {
  eventType: UiCommandEventType;
  eventVersion?: UiCommandEventVersion;
  payload: Record<string, unknown>;
}

/**
 * Централизованно собирает `UiCommandMessage`.
 *
 * В точечно типизированных местах этот helper сохраняет exact-связь между
 * `eventType`, `eventVersion` и `payload`. В schema-driven путях допускает
 * динамический payload, чтобы unsafe-cast не расползался по runtime/client.
 */
export function createUiCommandMessage<
  TEvent extends UiCommandEvent,
>(
  input: CreateUiCommandMessageInput<TEvent>,
): UiCommandMessage<TEvent>;
export function createUiCommandMessage(input: CreateUiCommandMessageDynamicInput): UiCommandMessage;
export function createUiCommandMessage(
  input: CreateUiCommandMessageInput | CreateUiCommandMessageDynamicInput,
): UiCommandMessage {
  return {
    type: 'ui.command',
    eventType: input.eventType,
    eventVersion: input.eventVersion ?? 1,
    payload: input.payload,
    ...(input.correlationId !== undefined ? { correlationId: input.correlationId } : {}),
  } as UiCommandMessage;
}

/**
 * Переводит UI boundary-сообщение во внутренний `RuntimeEventInput`.
 *
 * Helper нужен, чтобы держать единственный bridge-cast в `core`, а не
 * размазывать преобразование по `apps/runtime` и тестовым сценариям.
 */
export function uiCommandMessageToRuntimeEventInput<
  TEvent extends UiCommandEvent,
>(
  message: UiCommandMessage<TEvent>,
): Extract<RuntimeEventInput, { type: TEvent['type']; v: TEvent['v']; kind: 'command' }>;
export function uiCommandMessageToRuntimeEventInput(message: UiCommandMessage): Extract<RuntimeEventInput, { kind: 'command' }>;
export function uiCommandMessageToRuntimeEventInput(message: UiCommandMessage): Extract<RuntimeEventInput, { kind: 'command' }> {
  return {
    type: message.eventType,
    v: message.eventVersion,
    kind: 'command',
    priority: 'control',
    payload: message.payload,
    ...(message.correlationId !== undefined ? { correlationId: message.correlationId } : {}),
  } as Extract<RuntimeEventInput, { kind: 'command' }>;
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

export interface UiPluginMetric {
  pluginId: string;
  name: string;
  value: number;
  unit?: string;
  tags?: Record<string, string>;
}

export interface RuntimeTelemetrySnapshotPayload {
  queues: QueueTelemetry[];
  dropped: number;
  metrics: UiPluginMetric[];
}
