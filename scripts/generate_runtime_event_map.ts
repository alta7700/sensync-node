import { mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  RuntimeEventMapCodegenEntry,
  RuntimeEventMapCodegenSpec,
} from '../packages/core/src/runtime-event-map-codegen.ts';
import { sharedRuntimeEventMapSpec } from '../packages/core/src/runtime-event-map.spec.ts';
import { fakeRuntimeEventMapSpec } from '../packages/plugins-fake/src/runtime-event-map.spec.ts';
import { hdf5RuntimeEventMapSpec } from '../packages/plugins-hdf5/src/runtime-event-map.spec.ts';
import { antPlusRuntimeEventMapSpec } from '../packages/plugins-ant-plus/src/runtime-event-map.spec.ts';
import { bleRuntimeEventMapSpec } from '../packages/plugins-ble/src/runtime-event-map.spec.ts';
import { trignoRuntimeEventMapSpec } from '../packages/plugins-trigno/src/runtime-event-map.spec.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const allSpecs = [
  sharedRuntimeEventMapSpec,
  fakeRuntimeEventMapSpec,
  hdf5RuntimeEventMapSpec,
  antPlusRuntimeEventMapSpec,
  bleRuntimeEventMapSpec,
  trignoRuntimeEventMapSpec,
] as const;

function importLine(pathLiteral: string, typeNames: string[]): string {
  const uniqueNames = [...new Set(typeNames)].sort((left, right) => left.localeCompare(right));
  return `import type { ${uniqueNames.join(', ')} } from '${pathLiteral}';`;
}

function payloadType(entry: Extract<RuntimeEventMapCodegenEntry, { mode: 'compose' }>): string {
  if (entry.payload.kind === 'inline') {
    return entry.payload.typeText;
  }
  return entry.payload.typeName;
}

function entryTypeExpression(entry: RuntimeEventMapCodegenEntry): string {
  if (entry.mode === 'reference') {
    return entry.typeName;
  }

  const baseType = entry.envelope === 'command' ? 'CommandEvent' : 'FactEvent';
  return `${baseType}<${payloadType(entry)}, '${entry.type}'> & {
  v: ${entry.v};
  kind: '${entry.kind}';
  priority: '${entry.priority}';
}`;
}

function buildFile(spec: RuntimeEventMapCodegenSpec): string {
  const importsByPath = new Map<string, string[]>();
  const coreImports = new Set<string>(['RuntimeEventMap']);

  for (const entry of spec.entries) {
    if (entry.mode === 'compose') {
      coreImports.add(entry.envelope === 'command' ? 'CommandEvent' : 'FactEvent');
      if (entry.payload.kind === 'named') {
        const list = importsByPath.get(entry.payload.importPath) ?? [];
        list.push(entry.payload.typeName);
        importsByPath.set(entry.payload.importPath, list);
      }
      continue;
    }

    const list = importsByPath.get(entry.importPath) ?? [];
    list.push(entry.typeName);
    importsByPath.set(entry.importPath, list);
  }

  const lines: string[] = [];
  lines.push('// Этот файл сгенерирован `npm run generate:runtime-event-map`.');
  lines.push('// Не редактируй его вручную: править нужно *.spec.ts и генератор.');
  lines.push('');
  lines.push(importLine(spec.coreImportPath, [...coreImports]));

  for (const [importPath, names] of [...importsByPath.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    if (importPath === spec.coreImportPath) {
      lines[lines.length - 1] = importLine(spec.coreImportPath, [...coreImports, ...names]);
      continue;
    }
    lines.push(importLine(importPath, names));
  }

  lines.push('');

  for (const entry of spec.entries) {
    lines.push(`export type ${entry.alias} = ${entryTypeExpression(entry)};`);
    lines.push('');
  }

  lines.push(`declare module '${spec.moduleToAugment}' {`);
  lines.push('  interface RuntimeEventMap {');
  for (const entry of spec.entries) {
    lines.push(`    '${entry.type}@${entry.v}': ${entry.alias};`);
  }
  lines.push('  }');
  lines.push('}');
  lines.push('');
  lines.push('export {};');
  lines.push('');

  return lines.join('\n');
}

function writeGeneratedFile(spec: RuntimeEventMapCodegenSpec): void {
  const absolutePath = path.join(repoRoot, spec.outputFilePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, buildFile(spec), 'utf8');
  console.log(`generated: ${spec.outputFilePath}`);
}

for (const spec of allSpecs) {
  writeGeneratedFile(spec);
}
