import {
  type ArgumentMetadata,
  BadRequestException,
  Injectable,
  type PipeTransform,
} from '@nestjs/common';

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_ARRAY_LENGTH = 1_000;
const MAX_DEPTH = 12;
const MAX_KEY_LENGTH = 128;
const MAX_NODES = 10_000;

interface TraversalState {
  nodes: number;
}

function assertSafeInput(value: unknown, depth: number, path: string, state: TraversalState): void {
  state.nodes += 1;
  if (state.nodes > MAX_NODES) throw new BadRequestException('Request structure is too large');
  if (depth > MAX_DEPTH) throw new BadRequestException('Request structure is too deeply nested');
  if (value === null || typeof value !== 'object') return;

  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_LENGTH) {
      throw new BadRequestException('Request array exceeds the global safety limit');
    }
    value.forEach((item, index) => assertSafeInput(item, depth + 1, `${path}[${index}]`, state));
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key) || key.length > MAX_KEY_LENGTH) {
      throw new BadRequestException(`Unsafe request key at ${path}`);
    }
    assertSafeInput(child, depth + 1, `${path}.${key}`, state);
  }
}

@Injectable()
export class RequestBoundaryPipe implements PipeTransform<unknown, unknown> {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    if (!['body', 'query', 'param'].includes(metadata.type)) return value;
    assertSafeInput(value, 0, metadata.type, { nodes: 0 });
    return value;
  }
}
