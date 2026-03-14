import {
  findUiCommandBoundaryGuard,
  sharedUiCommandBoundaryGuards,
  type EventRef,
  type UiCommandBoundaryGuard,
} from '@sensync2/core';
import { trignoUiCommandBoundaryGuards } from '@sensync2/plugins-trigno';

const workspaceUiCommandBoundaryGuards = [
  ...sharedUiCommandBoundaryGuards,
  ...trignoUiCommandBoundaryGuards,
] as const;

export type WorkspaceUiCommandBoundaryGuard = (typeof workspaceUiCommandBoundaryGuards)[number];

export function findWorkspaceUiCommandBoundaryGuard(ref: EventRef): WorkspaceUiCommandBoundaryGuard | undefined {
  return findUiCommandBoundaryGuard(workspaceUiCommandBoundaryGuards, ref) as WorkspaceUiCommandBoundaryGuard | undefined;
}

export function listWorkspaceUiCommandBoundaryGuards(): readonly UiCommandBoundaryGuard[] {
  return workspaceUiCommandBoundaryGuards;
}
