import { describe, expect, it } from 'vitest';
import { TrignoEventTypes } from '@sensync2/plugins-trigno';
import { WorkspaceEventRegistry } from './workspace-event-registry.ts';
import { findWorkspaceUiCommandBoundaryGuard } from './workspace-ui-command-boundary.ts';

describe('workspace-ui-command-boundary', () => {
  it('регистрирует Trigno UI guard и runtime event contracts', () => {
    const guard = findWorkspaceUiCommandBoundaryGuard({
      type: TrignoEventTypes.streamStartRequest,
      v: 1,
    });

    expect(guard).toBeDefined();
    expect(guard?.isPayload({ adapterId: 'trigno' })).toBe(true);

    const registry = new WorkspaceEventRegistry();
    expect(registry.has({ type: TrignoEventTypes.statusReported, v: 1 })).toBe(true);
  });
});
