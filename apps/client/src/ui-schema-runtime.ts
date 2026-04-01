import type {
  UiControlPayloadBinding,
  UiFormOption,
  UiModalForm,
  UiModalFormNode,
  UiModalFormSelect,
  UiSessionClockInfo,
} from '@sensync2/core';

type UiFlagsMap = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function visitModalFormFields(
  nodes: UiModalFormNode[],
  visitor: (field: Exclude<UiModalFormNode, { kind: 'row' | 'column' }>) => void,
): void {
  for (const node of nodes) {
    if (node.kind === 'row' || node.kind === 'column') {
      visitModalFormFields(node.children, visitor);
      continue;
    }
    visitor(node);
  }
}

export function buildModalInitialValues(form: UiModalForm): Record<string, string> {
  const values: Record<string, string> = {};
  visitModalFormFields(form.fields, (field) => {
    if (field.kind === 'textInput' || field.kind === 'timelineTimeInput') {
      values[field.fieldId] = field.defaultValue ?? '';
      return;
    }
    if (field.kind === 'numberInput' || field.kind === 'decimalInput') {
      values[field.fieldId] = field.defaultValue !== undefined ? String(field.defaultValue) : '';
      return;
    }
    if (field.kind === 'fileInput' || field.kind === 'select') {
      values[field.fieldId] = field.defaultValue ?? '';
    }
  });
  return values;
}

function findSelectedOption(
  field: UiModalFormSelect,
  formOptions: Record<string, UiFormOption[]>,
  value: string,
): UiFormOption | undefined {
  const options = formOptions[field.sourceId] ?? [];
  return options.find((option) => option.value === value);
}

export function parseTimelineRelativeTime(value: string): { ok: true; relativeMs: number } | { ok: false; error: string } {
  const trimmed = value.trim();
  if (!/^\d+(?::\d{1,2}){1,2}$/.test(trimmed)) {
    return {
      ok: false,
      error: 'Время должно быть в формате mm:ss или hh:mm:ss',
    };
  }

  const parts = trimmed.split(':').map((part) => Number(part));
  if (parts.some((part) => !Number.isInteger(part) || part < 0)) {
    return {
      ok: false,
      error: 'Время должно состоять только из неотрицательных целых частей',
    };
  }

  const [hours, minutes, seconds] = parts.length === 3
    ? parts
    : [0, parts[0] ?? 0, parts[1] ?? 0];

  if ((seconds ?? 0) >= 60 || (parts.length === 3 && (minutes ?? 0) >= 60)) {
    return {
      ok: false,
      error: 'Секунды и минуты должны быть меньше 60',
    };
  }

  return {
    ok: true,
    relativeMs: ((hours ?? 0) * 3_600 + (minutes ?? 0) * 60 + (seconds ?? 0)) * 1_000,
  };
}

export function buildModalSubmitPayload(
  form: UiModalForm,
  values: Record<string, string>,
  formOptions: Record<string, UiFormOption[]>,
  clock?: UiSessionClockInfo,
): { ok: true; payload: Record<string, unknown> } | { ok: false; error: string } {
  const payloadFieldValues: Record<string, unknown> = {};
  const formDataFieldValues: Record<string, unknown> = {};
  const mergedOptionPayloads: Record<string, unknown> = {};

  let validationError: string | null = null;

  visitModalFormFields(form.fields, (field) => {
    if (validationError) return;

    const rawValue = values[field.fieldId] ?? '';
    const trimmed = rawValue.trim();
    if (field.required && trimmed.length === 0) {
      validationError = `Поле "${field.label}" обязательно`;
      return;
    }
    if (trimmed.length === 0) {
      return;
    }

    let parsedValue: unknown;
    if (field.kind === 'textInput' || field.kind === 'fileInput') {
      parsedValue = rawValue;
    } else if (field.kind === 'numberInput' || field.kind === 'decimalInput') {
      const parsed = Number(rawValue);
      if (!Number.isFinite(parsed)) {
        validationError = `Поле "${field.label}" должно быть числом`;
        return;
      }
      parsedValue = parsed;
    } else if (field.kind === 'timelineTimeInput') {
      if (!clock) {
        validationError = 'Текущее время timeline недоступно';
        return;
      }
      const parsed = parseTimelineRelativeTime(rawValue);
      if (!parsed.ok) {
        validationError = `Поле "${field.label}": ${parsed.error}`;
        return;
      }
      parsedValue = clock.timelineStartSessionMs + parsed.relativeMs;
    } else {
      parsedValue = rawValue;
      if (field.mergeSelectedOptionPayload) {
        const selectedOption = findSelectedOption(field, formOptions, rawValue);
        if (selectedOption?.payload) {
          Object.assign(mergedOptionPayloads, selectedOption.payload);
        }
      }
    }

    if ((field.submitTarget ?? 'formData') === 'payload') {
      payloadFieldValues[field.fieldId] = parsedValue;
      return;
    }
    formDataFieldValues[field.fieldId] = parsedValue;
  });

  if (validationError) {
    return { ok: false, error: validationError };
  }

  const payload = {
    ...(form.submitPayload ?? {}),
    ...payloadFieldValues,
  };
  const baseFormData = isRecord(payload.formData) ? { ...payload.formData } : {};
  const mergedFormData = {
    ...baseFormData,
    ...formDataFieldValues,
    ...mergedOptionPayloads,
  };
  if (Object.keys(mergedFormData).length > 0 || payload.formData !== undefined) {
    payload.formData = mergedFormData;
  }

  return { ok: true, payload };
}

export function resolveControlPayload(
  basePayload: Record<string, unknown> | undefined,
  payloadBindings: UiControlPayloadBinding[] | undefined,
  flags: UiFlagsMap,
): Record<string, unknown> | undefined {
  if ((!basePayload || Object.keys(basePayload).length === 0) && (!payloadBindings || payloadBindings.length === 0)) {
    return undefined;
  }

  const payload = { ...(basePayload ?? {}) };
  for (const binding of payloadBindings ?? []) {
    if (binding.kind !== 'number-from-flag') {
      continue;
    }

    const rawFlagValue = flags[binding.flagKey];
    let value = typeof rawFlagValue === 'number' && Number.isFinite(rawFlagValue)
      ? rawFlagValue
      : (binding.fallbackValue ?? 0);

    if (binding.add !== undefined) {
      value += binding.add;
    }
    if (binding.min !== undefined) {
      value = Math.max(binding.min, value);
    }
    if (binding.max !== undefined) {
      value = Math.min(binding.max, value);
    }
    if (binding.round === 'integer') {
      value = Math.round(value);
    }

    payload[binding.payloadKey] = value;
  }

  return payload;
}
