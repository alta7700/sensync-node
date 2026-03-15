import type {
  CompiledStateExpression,
  StateExpression,
} from './types.ts';

function compileNode<TStateKey extends string>(
  expression: StateExpression<TStateKey>,
): CompiledStateExpression<TStateKey> {
  if ('state' in expression) {
    return (reader) => Object.is(reader(expression.state), expression.eq);
  }
  if ('and' in expression) {
    const compiled = expression.and.map((child) => compileNode(child));
    return (reader) => compiled.every((candidate) => candidate(reader));
  }
  if ('or' in expression) {
    const compiled = expression.or.map((child) => compileNode(child));
    return (reader) => compiled.some((candidate) => candidate(reader));
  }
  const compiled = compileNode(expression.not);
  return (reader) => !compiled(reader);
}

export function compileStateExpression<TStateKey extends string>(
  expression: StateExpression<TStateKey>,
): CompiledStateExpression<TStateKey> {
  return compileNode(expression);
}
