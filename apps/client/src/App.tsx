import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts/core';
import type { ECharts } from 'echarts/core';
import type { EChartsOption, SeriesOption } from 'echarts';
import { GridComponent, LegendComponent, MarkAreaComponent, MarkLineComponent, TooltipComponent } from 'echarts/components';
import { LineChart, ScatterChart } from 'echarts/charts';
import { CanvasRenderer } from 'echarts/renderers';
import { ClientRuntime, type ClientRuntimeNotification, type StreamWindowData } from '@sensync2/client-runtime';
import type {
  UiControlAction,
  UiLayoutNode,
  UiChartSeries,
  UiChartWidget,
  UiCommandEventType,
  UiCommandEventVersion,
  UiControlWhen,
  UiControlsWidget,
  UiLineChartWidget,
  UiModalForm,
  UiStatusWidget,
  UiTelemetryWidget,
  UiWidget,
} from '@sensync2/core';
import { EventTypes } from '@sensync2/core';
import { ElectronBridgeTransport } from './electronTransport.ts';
import {
  formatCommaDecimal,
  formatTimelineRelativeTime,
  buildModalInitialValues,
  buildModalSubmitPayload,
  resolveControlPayload,
} from './ui-schema-runtime.ts';

echarts.use([GridComponent, LegendComponent, MarkAreaComponent, MarkLineComponent, TooltipComponent, LineChart, ScatterChart, CanvasRenderer]);

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
  commandType: UiCommandEventType | undefined;
  commandVersion: UiCommandEventVersion;
  payload: Record<string, unknown> | undefined;
  payloadBindings: UiControlAction['payloadBindings'];
  modalForm: UiModalForm | undefined;
  disabled: boolean;
  isLoading: boolean;
  hidden: boolean;
}

interface ModalState {
  form: UiModalForm;
  values: Record<string, string>;
  error: string | null;
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
      payloadBindings: control.payloadBindings,
      modalForm: control.modalForm,
      disabled: control.disabled,
      isLoading: control.isLoading,
      visible: control.visible,
      hidden: control.hidden,
      ...matchedVariant,
    };

    const hasCommand = typeof merged.commandType === 'string' && merged.commandType.length > 0;
    const hasAction = hasCommand || merged.modalForm !== undefined;
    // `hidden` имеет приоритет над `visible`, чтобы конфликтующие схемы вели себя предсказуемо.
    const hidden = Boolean(merged.hidden) || merged.visible === false;
    return {
      label: merged.label ?? control.id,
      commandType: hasCommand ? merged.commandType : undefined,
      commandVersion: merged.commandVersion ?? 1,
      payload: merged.payload,
      payloadBindings: merged.payloadBindings,
      modalForm: merged.modalForm,
      // Если у варианта нет команды (например, состояние "подключение"), кнопку блокируем автоматически.
      disabled: Boolean(merged.disabled) || !hasAction,
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

function isRecordingControl(control: UiControlAction): boolean {
  return control.id.includes('record');
}

function buildRecordingControlSnapshot(
  widget: UiControlsWidget,
  flags: UiFlagsMap,
): Array<{
  id: string;
  label: string;
  disabled: boolean;
  isLoading: boolean;
  hidden: boolean;
}> {
  return widget.controls
    .filter((control) => isRecordingControl(control))
    .map((control) => {
      const resolved = resolveControlAction(control, flags);
      return {
        id: control.id,
        label: resolved.label,
        disabled: resolved.disabled,
        isLoading: resolved.isLoading,
        hidden: resolved.hidden,
      };
    });
}

function ControlsWidget(
  { widget, flags, onOpenModal }:
  { widget: UiControlsWidget; flags: Record<string, unknown>; onOpenModal: (form: UiModalForm) => void },
) {
  const recordingSnapshot = useMemo(() => buildRecordingControlSnapshot(widget, flags), [widget, flags]);
  const recordingFlags = useMemo(() => ({
    state: flags['recording.local.state'] ?? null,
    filePath: flags['recording.local.filePath'] ?? null,
    message: flags['recording.local.message'] ?? null,
  }), [flags]);
  const lastRecordingLogRef = useRef<string>('');

  useEffect(() => {
    if (recordingSnapshot.length === 0) return;

    const signature = JSON.stringify({
      widgetId: widget.id,
      flags: recordingFlags,
      snapshot: recordingSnapshot,
    });
    if (signature === lastRecordingLogRef.current) return;
    lastRecordingLogRef.current = signature;

    // Диагностика нужна только для переходов записи, чтобы увидеть:
    // дошёл ли `recording.local.state = idle` и какой variant выбрала кнопка.
    console.log('[ClientApp] recording control snapshot', {
      widgetId: widget.id,
      title: widget.title,
      flags: recordingFlags,
      snapshot: recordingSnapshot,
    });
  }, [recordingFlags, recordingSnapshot, widget.id, widget.title]);

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
                if (resolved.commandType) {
                  const runtimePayload = resolveControlPayload(resolved.payload, resolved.payloadBindings, flags);
                  void runtimeSingleton.sendCommand(resolved.commandType, resolved.commandVersion, runtimePayload);
                }
                if (resolved.modalForm) {
                  onOpenModal(resolved.modalForm);
                }
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

interface VeloergPowerControlProps {
  widget: UiControlsWidget;
  mode: 'autopilot' | 'manual';
  autopilotLocked: boolean;
  nextAutoRaiseAtMs: number | null;
  uiNowMs: number;
  currentPowerValue: number | null;
  manualValueText: string;
  error: string | null;
  disabled: boolean;
  onManualValueChange: (value: string) => void;
  onApplyManualValue: () => void;
  onPlus30: () => void;
  onRequestDisableAutopilot: () => void;
}

function VeloergPowerControl({
  widget,
  mode,
  autopilotLocked,
  nextAutoRaiseAtMs,
  uiNowMs,
  currentPowerValue,
  manualValueText,
  error,
  disabled,
  onManualValueChange,
  onApplyManualValue,
  onPlus30,
  onRequestDisableAutopilot,
}: VeloergPowerControlProps) {
  const remainingMs = mode === 'autopilot' && nextAutoRaiseAtMs !== null
    ? Math.max(0, nextAutoRaiseAtMs - uiNowMs)
    : null;
  const currentText = currentPowerValue === null ? '—' : `${Math.round(currentPowerValue)} W`;

  return (
    <section style={panelStyle}>
      <h3 style={titleStyle}>{widget.title}</h3>
      {mode === 'autopilot' ? (
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'baseline' }}>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>Текущая мощность</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{currentText}</div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'baseline' }}>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>До следующего поднятия</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>
              {remainingMs !== null ? formatTimelineRelativeTime(remainingMs) : '—'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={onRequestDisableAutopilot} style={modalSecondaryButtonStyle} disabled={disabled}>
              Отключить автопилот
            </button>
          </div>
          {autopilotLocked ? (
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>Автопилот можно снова включить только после reset timeline.</div>
          ) : null}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'baseline' }}>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>Текущая мощность</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{currentText}</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1fr) auto auto', gap: 12, alignItems: 'end' }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>Новое значение</span>
              <input
                type="number"
                min={0}
                step={1}
                value={manualValueText}
                onChange={(event) => onManualValueChange(event.target.value)}
                style={modalInputStyle}
                disabled={disabled}
              />
            </label>
            <button type="button" onClick={onApplyManualValue} style={modalPrimaryButtonStyle} disabled={disabled}>
              OK
            </button>
            <button type="button" onClick={onPlus30} style={modalSecondaryButtonStyle} disabled={disabled}>
              +30
            </button>
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            Автопилот отключён до следующего reset timeline.
          </div>
          {disabled ? (
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              Ждём завершения `timeline.reset`.
            </div>
          ) : null}
          {error ? (
            <div style={{ color: 'var(--bad)', fontSize: 13 }}>{error}</div>
          ) : null}
        </div>
      )}
    </section>
  );
}

interface VeloergSummaryRowProps {
  widget: UiStatusWidget;
  uiNowMs: number;
  timelineAnchorWallMs: number;
  currentPowerText: string;
  currentHrText: string;
  currentSmo2Text: string;
  currentThbText: string;
}

function VeloergSummaryRow({
  widget,
  uiNowMs,
  timelineAnchorWallMs,
  currentPowerText,
  currentHrText,
  currentSmo2Text,
  currentThbText,
}: VeloergSummaryRowProps) {
  const currentTimeText = formatTimelineRelativeTime(Math.max(0, uiNowMs - timelineAnchorWallMs));
  const items = [
    { label: 'Текущее время теста', value: currentTimeText },
    { label: 'Текущий hr', value: currentHrText },
    { label: 'Текущая мощность', value: currentPowerText },
    { label: 'Текущий smo2', value: currentSmo2Text },
    { label: 'Текущий thb', value: currentThbText },
  ];

  return (
    <section style={panelStyle}>
      <h3 style={titleStyle}>{widget.title}</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 12 }}>
        {items.map((item) => (
          <div key={item.label} style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 6 }}>{item.label}</div>
            <div style={{ fontSize: 30, lineHeight: 1.05, fontWeight: 700, letterSpacing: -0.3, whiteSpace: 'nowrap' }}>
              {item.value}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

interface VeloergConfirmDialogProps {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function VeloergConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: VeloergConfirmDialogProps) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(2, 6, 12, 0.72)',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        zIndex: 1200,
      }}
    >
      <div
        style={{
          width: 'min(520px, 100%)',
          background: 'linear-gradient(180deg, rgba(22,27,34,0.98) 0%, rgba(13,17,23,0.98) 100%)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          boxShadow: '0 24px 48px rgba(0,0,0,0.28)',
          padding: 16,
          display: 'grid',
          gap: 16,
        }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: 18 }}>{title}</h3>
          <div style={{ marginTop: 8, color: 'var(--muted)', fontSize: 13 }}>{description}</div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'end', gap: 8 }}>
          <button type="button" onClick={onCancel} style={modalSecondaryButtonStyle}>{cancelLabel}</button>
          <button type="button" onClick={onConfirm} style={modalPrimaryButtonStyle}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

interface VeloergUiState {
  uiNowMs: number;
  timelineAnchorWallMs: number;
  powerMode: 'autopilot' | 'manual';
  powerAutopilotLocked: boolean;
  powerNextAutoRaiseAtMs: number | null;
  currentPowerValue: number | null;
  powerManualValueText: string;
  powerError: string | null;
  powerDisabled: boolean;
  currentHrText: string;
  currentSmo2Text: string;
  currentThbText: string;
  onPowerManualValueChange: (value: string) => void;
  onApplyManualValue: () => void;
  onPlus30: () => void;
  onRequestDisableAutopilot: () => void;
  onConfirmDisableAutopilot: () => void;
  onCancelDisableAutopilot: () => void;
}

function StatusWidget({ widget, flags }: { widget: UiStatusWidget; flags: Record<string, unknown> }) {
  const fields = widget.fields ?? widget.flagKeys.map((flagKey) => ({ flagKey, label: flagKey }));
  return (
    <section style={panelStyle}>
      <h3 style={titleStyle}>{widget.title}</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
        {fields.map((field) => {
          const value = flags[field.flagKey];
          const text = typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value ?? '—');
          const color = text.includes('connected') || text === 'true' ? 'var(--ok)' : text.includes('failed') ? 'var(--bad)' : 'var(--muted)';
          return (
            <div key={field.flagKey} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 8, background: '#11161d' }}>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{field.label ?? field.flagKey}</div>
              <div style={{ fontWeight: 700, color }}>{text}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function TelemetryWidget({ widget, telemetry }: { widget: UiTelemetryWidget; telemetry: ReturnType<typeof runtimeSingleton.getSnapshot>['telemetry'] }) {
  const metrics = telemetry?.metrics ?? [];
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
      {metrics.length > 0 ? (
        <>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 14, marginBottom: 8 }}>Plugin metrics</div>
          <div style={{ display: 'grid', gap: 6 }}>
            {metrics.map((metric) => {
              const tags = metric.tags
                ? Object.entries(metric.tags)
                  .map(([key, value]) => `${key}=${value}`)
                  .join(' ')
                : '';
              const value = Number.isInteger(metric.value) ? String(metric.value) : metric.value.toFixed(2);
              return (
                <div
                  key={`${metric.pluginId}:${metric.name}:${tags}`}
                  style={{ display: 'grid', gridTemplateColumns: '220px 1fr 110px 140px', gap: 8, fontSize: 12 }}
                >
                  <span>{metric.pluginId}</span>
                  <span>{metric.name}</span>
                  <span>{metric.unit ? `${value} ${metric.unit}` : value}</span>
                  <span style={{ color: 'var(--muted)' }}>{tags || '—'}</span>
                </div>
              );
            })}
          </div>
        </>
      ) : null}
    </section>
  );
}

function ToastStack({ notifications }: { notifications: ClientRuntimeNotification[] }) {
  useEffect(() => {
    if (notifications.length === 0) return;
    const timers = notifications.map((notification) => setTimeout(() => {
      runtimeSingleton.dismissNotification(notification.id);
    }, 4500));
    return () => {
      for (const timer of timers) {
        clearTimeout(timer);
      }
    };
  }, [notifications]);

  if (notifications.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 16,
        right: 16,
        display: 'grid',
        gap: 10,
        width: 360,
        zIndex: 1000,
      }}
    >
      {notifications.map((notification) => (
        <div
          key={notification.id}
          style={{
            border: notification.level === 'error'
              ? '1px solid rgba(248, 81, 73, 0.35)'
              : '1px solid rgba(210, 153, 34, 0.35)',
            background: notification.level === 'error'
              ? 'linear-gradient(180deg, rgba(76, 17, 19, 0.96) 0%, rgba(45, 13, 14, 0.96) 100%)'
              : 'linear-gradient(180deg, rgba(79, 53, 12, 0.96) 0%, rgba(56, 36, 7, 0.96) 100%)',
            color: notification.level === 'error' ? '#ffd7d5' : '#ffe9b3',
            borderRadius: 12,
            padding: 12,
            boxShadow: '0 12px 24px rgba(0,0,0,0.25)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'start' }}>
            <div>
              <div style={{ fontSize: 12, opacity: 0.8 }}>{notification.code}</div>
              <div style={{ fontWeight: 700, marginTop: 2 }}>{notification.message}</div>
            </div>
            <button
              type="button"
              onClick={() => runtimeSingleton.dismissNotification(notification.id)}
              style={{
                border: 'none',
                background: 'transparent',
                color: notification.level === 'error' ? '#ffd7d5' : '#ffe9b3',
                cursor: 'pointer',
                fontSize: 18,
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>
          {notification.pluginId ? (
            <div style={{ marginTop: 8, fontSize: 12, opacity: 0.78 }}>
              plugin: {notification.pluginId}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function ModalFormDialog(
  {
    state,
    formOptions,
    onChange,
    onClose,
    onSubmit,
    onSetError,
  }:
  {
    state: ModalState;
    formOptions: Record<string, UiFormOption[]>;
    onChange: (fieldId: string, value: string) => void;
    onClose: () => void;
    onSubmit: () => void;
    onSetError: (value: string | null) => void;
  },
) {
  const { form, values, error } = state;

  async function handlePickPath(fieldId: string, mode: 'existing-file' | 'existing-directory'): Promise<void> {
    if (!window.sensyncBridge?.pickPath) {
      onSetError('Выбор пути недоступен: desktop bridge не поддерживает pickPath');
      return;
    }
    const picked = await window.sensyncBridge.pickPath({ mode });
    if (picked) {
      onChange(fieldId, picked);
      onSetError(null);
    }
  }

  function renderNode(node: UiModalFormNode): React.ReactNode {
    if (node.kind === 'row') {
      return (
        <div key={`row-${node.children.map((child) => child.kind).join('-')}`} style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          {node.children.map((child) => renderNode(child))}
        </div>
      );
    }

    if (node.kind === 'column') {
      return (
        <div key={`column-${node.children.map((child) => child.kind).join('-')}`} style={{ display: 'grid', gap: 12 }}>
          {node.children.map((child) => renderNode(child))}
        </div>
      );
    }

    if (node.kind === 'fileInput') {
      return (
        <label key={node.fieldId} style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>{node.label}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={values[node.fieldId] ?? ''}
              readOnly
              placeholder={node.required ? 'Обязательное поле' : 'Не выбрано'}
              style={modalInputStyle}
            />
            <button
              type="button"
              onClick={() => {
                void handlePickPath(node.fieldId, node.mode);
              }}
              style={modalSecondaryButtonStyle}
            >
              Выбрать
            </button>
          </div>
        </label>
      );
    }

    if (node.kind === 'select') {
      const options = formOptions[node.sourceId] ?? [];
      return (
        <label key={node.fieldId} style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>{node.label}</span>
          <select
            value={values[node.fieldId] ?? ''}
            onChange={(event) => {
              onChange(node.fieldId, event.target.value);
              onSetError(null);
            }}
            style={modalInputStyle}
          >
            <option value="">{node.placeholder ?? 'Выберите значение'}</option>
            {options.map((option) => (
              <option key={option.value} value={option.value} disabled={option.disabled}>
                {option.label}{option.description ? ` — ${option.description}` : ''}
              </option>
            ))}
          </select>
        </label>
      );
    }

    const inputType = node.kind === 'textInput' || node.kind === 'timelineTimeInput' ? 'text' : 'number';
    return (
      <label key={node.fieldId} style={{ display: 'grid', gap: 6 }}>
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>{node.label}</span>
        <input
          type={inputType}
          value={values[node.fieldId] ?? ''}
          onChange={(event) => {
            onChange(node.fieldId, event.target.value);
            onSetError(null);
          }}
          step={node.kind === 'numberInput' || node.kind === 'decimalInput' ? (node.step ?? (node.kind === 'numberInput' ? 1 : 'any')) : undefined}
          min={node.kind === 'numberInput' || node.kind === 'decimalInput' ? node.min : undefined}
          max={node.kind === 'numberInput' || node.kind === 'decimalInput' ? node.max : undefined}
          placeholder={node.kind === 'textInput' || node.kind === 'timelineTimeInput' ? node.placeholder : undefined}
          style={modalInputStyle}
        />
      </label>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(2, 6, 12, 0.72)',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        zIndex: 1100,
      }}
    >
      <div
        style={{
          width: 'min(640px, 100%)',
          background: 'linear-gradient(180deg, rgba(22,27,34,0.98) 0%, rgba(13,17,23,0.98) 100%)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          boxShadow: '0 24px 48px rgba(0,0,0,0.28)',
          padding: 16,
          display: 'grid',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'start' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 18 }}>{form.title}</h3>
            <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>
              Значения формы собираются локально и отправляются только при submit.
            </div>
          </div>
          <button type="button" onClick={onClose} style={modalSecondaryButtonStyle}>Закрыть</button>
        </div>

        <div style={{ display: 'grid', gap: 12 }}>
          {form.fields.map((node) => renderNode(node))}
        </div>

        {error ? (
          <div style={{ color: 'var(--bad)', fontSize: 13 }}>{error}</div>
        ) : null}

        <div style={{ display: 'flex', justifyContent: 'end', gap: 8 }}>
          <button type="button" onClick={onClose} style={modalSecondaryButtonStyle}>Отмена</button>
          <button type="button" onClick={onSubmit} style={modalPrimaryButtonStyle}>
            {form.submitLabel ?? 'Отправить'}
          </button>
        </div>
      </div>
    </div>
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
      <h3 style={chartTitleStyle}>{widget.title}</h3>
      <div style={{ position: 'relative' }}>
        <canvas ref={canvasRef} style={{ width: '100%', height: widget.height ?? 260, display: 'block', borderRadius: 10, border: '1px solid var(--border)' }} />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8, fontSize: 14, color: 'var(--muted)' }}>
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
  }, [widget.series, timeWindowMs, widget.yAxis?.min, widget.yAxis?.max]);

  return (
    <section style={panelStyle}>
      <h3 style={chartTitleStyle}>{widget.title}</h3>
      <div style={{ position: 'relative' }}>
        <canvas ref={canvasRef} style={{ width: '100%', height: widget.height ?? 260, display: 'block', borderRadius: 10, border: '1px solid var(--border)' }} />
      </div>
      <div style={{ marginTop: 8, fontSize: 14, color: 'var(--muted)', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
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
      const requestedRangeMs = widget.viewportMode === 'history'
        ? Number.MAX_SAFE_INTEGER
        : timeWindowMs;
      const win = runtimeSingleton.getVisibleWindow(series.streamId, requestedRangeMs, undefined, {
        includeLastSampleBeforeStart: series.type === 'line' && series.interpolation === 'step-after',
      });
      windowsByStream.set(series.streamId, win);
      // Диагностику монотонности проверяем только для line-серий.
      // Для scatter/label потоков одинаковые timestamp могут быть валидным случаем.
      if (series.type === 'line') {
        logMonotonicTimeArrayCheck(series.streamId, win.x, win.length);
      }
    }
  }
  return windowsByStream;
}

function buildChartXRange(widget: UiChartWidget, windowsByStream: Map<string, StreamWindowData>): { min: number; max: number } {
  const timeWindowMs = widget.timeWindowMs ?? 10_000;
  let xMinMs = 0;
  let xMaxMs = 0;
  let hasAnyTime = false;

  for (const win of windowsByStream.values()) {
    if (win.length === 0) continue;
    const first = win.x[0]!;
    const last = win.x[win.length - 1]!;
    if (!hasAnyTime || first < xMinMs) xMinMs = first;
    if (!hasAnyTime || last > xMaxMs) xMaxMs = last;
    hasAnyTime = true;
  }

  if (!hasAnyTime) {
    return { min: 0, max: timeWindowMs };
  }

  if (widget.viewportMode === 'history') {
    if (xMaxMs <= xMinMs) {
      return { min: xMinMs, max: xMinMs + Math.max(1_000, timeWindowMs) };
    }
    return { min: xMinMs, max: xMaxMs };
  }

  return {
    min: Math.max(0, xMaxMs - timeWindowMs),
    max: xMaxMs,
  };
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

function buildChartVerticalMarkerSeries(
  widget: UiChartWidget,
  flags: Record<string, unknown>,
): SeriesOption | null {
  const markers = widget.markers ?? [];
  const data = markers.flatMap((marker) => {
    if (marker.kind !== 'vertical-flag') {
      return [];
    }
    const rawValue = flags[marker.flagKey];
    const numericValue = typeof rawValue === 'number'
      ? rawValue
      : typeof rawValue === 'string' && rawValue.trim().length > 0
        ? Number(rawValue)
        : Number.NaN;
    if (!Number.isFinite(numericValue)) {
      return [];
    }

    const labelValue = marker.labelFlagKey !== undefined
      ? flags[marker.labelFlagKey]
      : undefined;
    const label = labelValue !== undefined && labelValue !== null
      ? String(labelValue)
      : marker.label;
    return [{
      name: label,
      xAxis: numericValue * (marker.valueMultiplier ?? 1),
      lineStyle: {
        color: marker.color ?? '#ffd43b',
        type: marker.lineStyle ?? 'dashed',
        width: 2,
      },
      label: label
        ? {
          show: true,
          formatter: label,
          color: marker.color ?? '#ffd43b',
          fontWeight: 700,
        }
        : {
          show: false,
        },
    }];
  });

  if (data.length === 0) {
    return null;
  }

  return {
    id: `${widget.id}-vertical-markers`,
    name: `${widget.title} markers`,
    type: 'line',
    data: [],
    animation: false,
    silent: true,
    lineStyle: { opacity: 0 },
    itemStyle: { opacity: 0 },
    tooltip: { show: false },
    markLine: {
      symbol: ['none', 'none'],
      silent: true,
      animation: false,
      data,
    },
  };
}

function buildEchartsOption(
  widget: UiChartWidget,
  windowsByStream: Map<string, StreamWindowData>,
  flags: Record<string, unknown>,
): EChartsOption {
  const { min: xMinMs, max: xMaxMs } = buildChartXRange(widget, windowsByStream);
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
      const linePoints = [...points];
      if (series.interpolation === 'step-after' && linePoints.length > 0) {
        const lastPoint = linePoints[linePoints.length - 1];
        if (lastPoint && lastPoint[0] < xMaxMs) {
          linePoints.push([xMaxMs, lastPoint[1]]);
        }
      }
      const lineSeries: SeriesOption = {
        id,
        name,
        type: 'line',
        data: linePoints,
        animation: false,
        showSymbol: false,
        step: series.interpolation === 'step-after' ? 'end' : undefined,
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
  const markerSeries = buildChartVerticalMarkerSeries(widget, flags);
  if (markerSeries) {
    seriesOptions.push(markerSeries);
  }

  const option: EChartsOption = {
    animation: false,
    grid: {
      left: 56,
      right: 16,
      top: widget.showLegend ? 36 : 12,
      bottom: widget.viewportMode === 'history' ? 60 : 28,
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
            textStyle: { color: '#9aa4b2', fontSize: 13 },
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

  if (widget.viewportMode === 'history') {
    option.dataZoom = [
      {
        id: `${widget.id}-history-slider`,
        type: 'slider',
        xAxisIndex: 0,
        filterMode: 'none',
        bottom: 12,
        height: 20,
      },
      {
        id: `${widget.id}-history-inside`,
        type: 'inside',
        xAxisIndex: 0,
        filterMode: 'none',
      },
    ];
  }

  return option;
}

function extractChartMarkerFlags(widget: UiChartWidget, flags: Record<string, unknown>): Record<string, unknown> {
  const relevantKeys = new Set<string>();
  for (const marker of widget.markers ?? []) {
    if (marker.kind !== 'vertical-flag') {
      continue;
    }
    relevantKeys.add(marker.flagKey);
    if (marker.labelFlagKey) {
      relevantKeys.add(marker.labelFlagKey);
    }
  }
  return Object.fromEntries([...relevantKeys].map((key) => [key, flags[key]]));
}

function ChartWidgetEcharts({ widget, flags }: { widget: UiChartWidget; flags: Record<string, unknown> }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ECharts | null>(null);
  const markerFlags = useMemo(() => extractChartMarkerFlags(widget, flags), [widget, flags]);

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
      const option = buildEchartsOption(widget, windowsByStream, markerFlags);
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
  }, [widget, markerFlags]);

  return (
    <section style={panelStyle}>
      <h3 style={chartTitleStyle}>{widget.title}</h3>
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

function renderWidget(
  widget: UiWidget,
  flags: Record<string, unknown>,
  telemetry: ReturnType<typeof runtimeSingleton.getSnapshot>['telemetry'],
  onOpenModal: (form: UiModalForm) => void,
  veloergUi?: VeloergUiState,
) {
  if (widget.id === 'summary-main' && widget.kind === 'status' && veloergUi) {
    return (
      <VeloergSummaryRow
        key={widget.id}
        widget={widget}
        uiNowMs={veloergUi.uiNowMs}
        timelineAnchorWallMs={veloergUi.timelineAnchorWallMs}
        currentPowerText={veloergUi.currentPowerValue === null ? '—' : `${Math.round(veloergUi.currentPowerValue)} W`}
        currentHrText={veloergUi.currentHrText}
        currentSmo2Text={veloergUi.currentSmo2Text}
        currentThbText={veloergUi.currentThbText}
      />
    );
  }
  if (widget.id === 'controls-power' && widget.kind === 'controls' && veloergUi) {
    return (
      <VeloergPowerControl
        key={widget.id}
        widget={widget}
        mode={veloergUi.powerMode}
        autopilotLocked={veloergUi.powerAutopilotLocked}
        nextAutoRaiseAtMs={veloergUi.powerNextAutoRaiseAtMs}
        uiNowMs={veloergUi.uiNowMs}
        currentPowerValue={veloergUi.currentPowerValue}
        manualValueText={veloergUi.powerManualValueText}
        error={veloergUi.powerError}
        disabled={veloergUi.powerDisabled}
        onManualValueChange={veloergUi.onPowerManualValueChange}
        onApplyManualValue={veloergUi.onApplyManualValue}
        onPlus30={veloergUi.onPlus30}
        onRequestDisableAutopilot={veloergUi.onRequestDisableAutopilot}
      />
    );
  }

  if (widget.kind === 'controls') {
    return <ControlsWidget key={widget.id} widget={widget} flags={flags} onOpenModal={onOpenModal} />;
  }
  if (widget.kind === 'status') return <StatusWidget key={widget.id} widget={widget} flags={flags} />;
  if (widget.kind === 'chart') {
    if (widget.renderer === 'echarts') {
      return <ChartWidgetEcharts key={widget.id} widget={widget} flags={flags} />;
    }
    return <ChartWidgetCanvas key={widget.id} widget={widget} />;
  }
  if (widget.kind === 'line-chart') return <LineChartWidget key={widget.id} widget={widget} />;
  return <TelemetryWidget key={widget.id} widget={widget} telemetry={telemetry} />;
}

function layoutNodeStyle(node: UiLayoutNode): React.CSSProperties {
  const style: React.CSSProperties = {};
  if (node.minWidth !== undefined) {
    style.minWidth = node.minWidth;
  }
  if (node.minHeight !== undefined) {
    style.minHeight = node.minHeight;
  }
  return style;
}

function rowTrack(node: UiLayoutNode): string {
  const grow = node.grow ?? 1;
  const minWidth = Math.max(0, Math.trunc(node.minWidth ?? 0));
  if (minWidth > 0) {
    return `minmax(${minWidth}px, ${grow}fr)`;
  }
  return `minmax(0, ${grow}fr)`;
}

function renderLayoutNode(
  node: UiLayoutNode,
  widgetsById: ReadonlyMap<string, UiWidget>,
  flags: Record<string, unknown>,
  telemetry: ReturnType<typeof runtimeSingleton.getSnapshot>['telemetry'],
  onOpenModal: (form: UiModalForm) => void,
  veloergUi: VeloergUiState | undefined,
  key: string,
): React.ReactNode {
  if (node.kind === 'widget') {
    const widget = widgetsById.get(node.widgetId);
    if (!widget) return null;
    return (
      <div key={key} style={layoutNodeStyle(node)}>
        {renderWidget(widget, flags, telemetry, onOpenModal, veloergUi)}
      </div>
    );
  }

  const children = node.children
    .map((child, index) => renderLayoutNode(child, widgetsById, flags, telemetry, onOpenModal, veloergUi, `${key}-${index}`))
    .filter((child) => child !== null);

  return (
    <div
      key={key}
      style={{
        ...layoutNodeStyle(node),
        display: 'grid',
        gap: node.gap ?? 12,
        gridTemplateColumns: node.kind === 'row'
          ? node.children.map((child) => rowTrack(child)).join(' ')
          : 'minmax(0, 1fr)',
      }}
    >
      {children}
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  background: 'linear-gradient(180deg, rgba(22,27,34,0.92) 0%, rgba(13,17,23,0.92) 100%)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: 12,
  boxShadow: '0 12px 24px rgba(0,0,0,0.18)',
};

const titleStyle: React.CSSProperties = { margin: '0 0 10px', fontSize: 14, letterSpacing: 0.3 };
const chartTitleStyle: React.CSSProperties = { ...titleStyle, fontSize: 16 };
const modalInputStyle: React.CSSProperties = {
  width: '100%',
  border: '1px solid var(--border)',
  background: '#11161d',
  color: 'var(--text)',
  padding: '10px 12px',
  borderRadius: 10,
};
const modalSecondaryButtonStyle: React.CSSProperties = {
  border: '1px solid var(--border)',
  background: '#11161d',
  color: 'var(--text)',
  padding: '8px 12px',
  borderRadius: 10,
  cursor: 'pointer',
};
const modalPrimaryButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(88, 166, 255, 0.35)',
  background: 'linear-gradient(180deg, #234873 0%, #163a61 100%)',
  color: '#e6edf3',
  padding: '8px 12px',
  borderRadius: 10,
  cursor: 'pointer',
};

const MAX_POWER_VALUE = 1000;

function formatValueLimitError(label: string, limit: number): string {
  return `${label} должен быть < ${limit}`;
}

export function App() {
  const { snapshot } = useRuntimeSnapshot();
  const [modal, setModal] = useState<ModalState | null>(null);
  const [uiNowMs, setUiNowMs] = useState(() => Date.now());
  const [timelineAnchorWallMs, setTimelineAnchorWallMs] = useState(() => Date.now());
  const [powerMode, setPowerMode] = useState<'autopilot' | 'manual'>('autopilot');
  const [powerAutopilotLocked, setPowerAutopilotLocked] = useState(false);
  const [powerAutopilotStepCount, setPowerAutopilotStepCount] = useState(0);
  const [powerNextAutoRaiseAtMs, setPowerNextAutoRaiseAtMs] = useState<number | null>(null);
  const [powerManualValueText, setPowerManualValueText] = useState('30');
  const [powerError, setPowerError] = useState<string | null>(null);
  const [powerDisableConfirmOpen, setPowerDisableConfirmOpen] = useState(false);
  const [powerDisplayOverride, setPowerDisplayOverride] = useState<number | null>(30);
  const powerAutopilotTimerRef = useRef<number | null>(null);
  const page = useMemo(() => snapshot.schema?.pages[0], [snapshot.schema]);
  const widgetsById = useMemo(() => {
    if (!snapshot.schema || !page) return new Map<string, UiWidget>();
    return new Map(snapshot.schema.widgets.map((widget) => [widget.id, widget]));
  }, [snapshot.schema, page]);
  const widgetRows = useMemo(() => {
    if (!page) return [];
    const rows = page.widgetRows && page.widgetRows.length > 0
      ? page.widgetRows
      : page.widgetIds.map((id) => [id]);
    return rows
      .map((row) => row.map((id) => widgetsById.get(id)).filter(Boolean) as UiWidget[])
      .filter((row) => row.length > 0);
  }, [page, widgetsById]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setUiNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timelineKey = snapshot.clock
      ? `${snapshot.clock.timelineId}:${snapshot.clock.timelineStartSessionMs}`
      : null;
    if (!timelineKey) {
      return;
    }

    setTimelineAnchorWallMs(Date.now());
    setPowerMode('autopilot');
    setPowerAutopilotLocked(false);
    setPowerAutopilotStepCount(0);
    setPowerManualValueText('30');
    setPowerError(null);
    setPowerDisableConfirmOpen(false);
    setPowerDisplayOverride(30);
    setPowerNextAutoRaiseAtMs(Date.now() + 60_000);

    void runtimeSingleton.sendCommand(EventTypes.labelMarkRequest, 1, {
      labelId: 'power',
      value: 30,
      atTimeMs: snapshot.clock.timelineStartSessionMs,
    }).catch((error: unknown) => {
      setPowerError(error instanceof Error ? error.message : 'Не удалось запустить автопилот мощности');
    });
  }, [snapshot.clock?.timelineId, snapshot.clock?.timelineStartSessionMs]);

  useEffect(() => () => {
    if (powerAutopilotTimerRef.current !== null) {
      window.clearTimeout(powerAutopilotTimerRef.current);
      powerAutopilotTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (powerAutopilotTimerRef.current !== null) {
      window.clearTimeout(powerAutopilotTimerRef.current);
      powerAutopilotTimerRef.current = null;
    }

    if (!snapshot.clock || powerMode !== 'autopilot' || powerAutopilotLocked || powerNextAutoRaiseAtMs === null) {
      return;
    }

    const delayMs = Math.max(0, powerNextAutoRaiseAtMs - Date.now());
    powerAutopilotTimerRef.current = window.setTimeout(() => {
      if (!snapshot.clock || powerMode !== 'autopilot' || powerAutopilotLocked) {
        return;
      }

      const nextValue = 60 + (powerAutopilotStepCount * 30);
      if (nextValue >= MAX_POWER_VALUE) {
        setPowerError(formatValueLimitError('Мощность', MAX_POWER_VALUE));
        setPowerMode('manual');
        setPowerAutopilotLocked(true);
        setPowerNextAutoRaiseAtMs(null);
        if (powerAutopilotTimerRef.current !== null) {
          window.clearTimeout(powerAutopilotTimerRef.current);
          powerAutopilotTimerRef.current = null;
        }
        return;
      }
      const nextRelativeMs = Math.max(0, Date.now() - timelineAnchorWallMs);
      void runtimeSingleton.sendCommand(EventTypes.labelMarkRequest, 1, {
        labelId: 'power',
        value: nextValue,
        atTimeMs: snapshot.clock.timelineStartSessionMs + nextRelativeMs,
      }).catch((error: unknown) => {
        setPowerError(error instanceof Error ? error.message : 'Не удалось отправить автопилот мощности');
      });
      setPowerDisplayOverride(nextValue);
      setPowerAutopilotStepCount((current) => current + 1);
      setPowerNextAutoRaiseAtMs(Date.now() + 180_000);
    }, delayMs);

    return () => {
      if (powerAutopilotTimerRef.current !== null) {
        window.clearTimeout(powerAutopilotTimerRef.current);
        powerAutopilotTimerRef.current = null;
      }
    };
  }, [
    powerAutopilotLocked,
    powerAutopilotStepCount,
    powerMode,
    powerNextAutoRaiseAtMs,
    snapshot.clock?.timelineId,
    snapshot.clock?.timelineStartSessionMs,
    timelineAnchorWallMs,
  ]);

  const currentPowerValue = typeof snapshot.flags['power.current'] === 'number'
    ? snapshot.flags['power.current'] as number
    : null;
  const visiblePowerValue = powerDisplayOverride ?? currentPowerValue ?? 30;
  const currentHrValue = runtimeSingleton.getLatestValue('zephyr.hr');
  const currentSmo2Value = runtimeSingleton.getLatestValue('moxy.smo2');
  const currentThbValue = runtimeSingleton.getLatestValue('moxy.thb');
  const currentHrText = currentHrValue === null ? '—' : String(Math.round(currentHrValue));
  const currentSmo2Text = currentSmo2Value === null ? '—' : formatCommaDecimal(currentSmo2Value, 1);
  const currentThbText = currentThbValue === null ? '—' : formatCommaDecimal(currentThbValue, 1);

  useEffect(() => {
    if (powerDisplayOverride !== null && currentPowerValue !== null && currentPowerValue === powerDisplayOverride) {
      setPowerDisplayOverride(null);
    }
  }, [currentPowerValue, powerDisplayOverride]);

  async function submitPowerMark(value: number, atRelativeMs?: number): Promise<void> {
    if (!snapshot.clock) {
      throw new Error('Текущий timeline недоступен');
    }
    await runtimeSingleton.sendCommand(EventTypes.labelMarkRequest, 1, {
      labelId: 'power',
      value,
      atTimeMs: snapshot.clock.timelineStartSessionMs + (atRelativeMs ?? Math.max(0, Date.now() - timelineAnchorWallMs)),
    });
  }

  async function applyManualPowerValue(): Promise<void> {
    const parsed = Number(powerManualValueText.replace(',', '.'));
    if (!Number.isFinite(parsed)) {
      setPowerError('Мощность должна быть числом');
      return;
    }
    const normalized = Math.max(0, Math.round(parsed));
    if (normalized >= MAX_POWER_VALUE) {
      setPowerError(formatValueLimitError('Мощность', MAX_POWER_VALUE));
      return;
    }
    setPowerError(null);
    try {
      await submitPowerMark(normalized);
    } catch (error) {
      setPowerError(error instanceof Error ? error.message : 'Не удалось отправить мощность');
      return;
    }
    setPowerDisplayOverride(normalized);
    setPowerManualValueText(String(normalized));
  }

  async function applyPowerPlus30(): Promise<void> {
    const current = visiblePowerValue;
    const nextValue = Math.max(0, Math.round(current + 30));
    if (nextValue >= MAX_POWER_VALUE) {
      setPowerError(formatValueLimitError('Мощность', MAX_POWER_VALUE));
      return;
    }
    setPowerError(null);
    try {
      await submitPowerMark(nextValue);
    } catch (error) {
      setPowerError(error instanceof Error ? error.message : 'Не удалось отправить мощность');
      return;
    }
    setPowerDisplayOverride(nextValue);
    setPowerManualValueText(String(nextValue));
  }

  function requestDisableAutopilot(): void {
    setPowerDisableConfirmOpen(true);
  }

  function confirmDisableAutopilot(): void {
    setPowerDisableConfirmOpen(false);
    setPowerMode('manual');
    setPowerAutopilotLocked(true);
    setPowerNextAutoRaiseAtMs(null);
    if (powerAutopilotTimerRef.current !== null) {
      window.clearTimeout(powerAutopilotTimerRef.current);
      powerAutopilotTimerRef.current = null;
    }
    setPowerManualValueText(String(Math.round(visiblePowerValue)));
  }

  function cancelDisableAutopilot(): void {
    setPowerDisableConfirmOpen(false);
  }

  const veloergUi: VeloergUiState | undefined = snapshot.clock ? {
    uiNowMs,
    timelineAnchorWallMs,
    powerMode,
    powerAutopilotLocked,
    powerNextAutoRaiseAtMs,
    currentPowerValue: visiblePowerValue,
    powerManualValueText,
    powerError,
    powerDisabled: false,
    currentHrText,
    currentSmo2Text,
    currentThbText,
    onPowerManualValueChange: setPowerManualValueText,
    onApplyManualValue: () => {
      void applyManualPowerValue();
    },
    onPlus30: () => {
      void applyPowerPlus30();
    },
    onRequestDisableAutopilot: requestDisableAutopilot,
    onConfirmDisableAutopilot: confirmDisableAutopilot,
    onCancelDisableAutopilot: cancelDisableAutopilot,
  } : undefined;

  function openModal(form: UiModalForm): void {
    setModal({
      form,
      values: buildModalInitialValues(form),
      error: null,
    });
  }

  function updateModalValue(fieldId: string, value: string): void {
    setModal((prev) => (prev ? { ...prev, values: { ...prev.values, [fieldId]: value } } : prev));
  }

  function setModalError(error: string | null): void {
    setModal((prev) => (prev ? { ...prev, error } : prev));
  }

  async function submitModal(): Promise<void> {
    if (!modal) return;
    const built = buildModalSubmitPayload(modal.form, modal.values, snapshot.formOptions, snapshot.clock);
    if (!built.ok) {
      setModalError(built.error);
      return;
    }
    await runtimeSingleton.sendCommand(modal.form.submitEventType, modal.form.submitEventVersion ?? 1, built.payload);
    setModal(null);
  }

  return (
    <div style={{ minHeight: '100%', padding: 16, display: 'grid', gap: 12, alignContent: 'start', overflowX: 'auto' }}>
      <ToastStack notifications={snapshot.notifications} />
      {modal ? (
        <ModalFormDialog
          state={modal}
          formOptions={snapshot.formOptions}
          onChange={updateModalValue}
          onClose={() => setModal(null)}
          onSubmit={() => {
            void submitModal();
          }}
          onSetError={setModalError}
        />
      ) : null}
      {powerDisableConfirmOpen ? (
        <VeloergConfirmDialog
          title="Отключить автопилот?"
          description="После отключения останется только ручной режим до следующего reset timeline."
          confirmLabel="Отключить"
          cancelLabel="Отмена"
          onConfirm={confirmDisableAutopilot}
          onCancel={cancelDisableAutopilot}
        />
      ) : null}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>Sensync2</h1>
          <div style={{ color: 'var(--muted)', fontSize: 12 }}>
            {snapshot.connected ? `connected${snapshot.sessionId ? ` • ${snapshot.sessionId}` : ''}` : 'disconnected'}
          </div>
        </div>
      </header>

      {!snapshot.schema ? (
        <section style={panelStyle}>
          <h3 style={titleStyle}>Ожидание схемы UI</h3>
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>
            Renderer подключен, ожидаем `ui.init` от `ui-gateway`.
          </div>
        </section>
      ) : page?.layout ? (
        renderLayoutNode(page.layout, widgetsById, snapshot.flags, snapshot.telemetry, openModal, veloergUi, `layout-${page.id}`)
      ) : (
        widgetRows.map((row, idx) => (
          <div
            key={`row-${idx}`}
            style={{
              display: 'grid',
              gap: 12,
              gridTemplateColumns: row.length > 1 ? `repeat(${row.length}, minmax(0, 1fr))` : 'minmax(0, 1fr)',
            }}
          >
            {row.map((widget) => renderWidget(widget, snapshot.flags, snapshot.telemetry, openModal, veloergUi))}
          </div>
        ))
      )}
    </div>
  );
}
