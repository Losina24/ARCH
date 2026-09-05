import type { AgentMeshConfig } from '@losina/schemas';
import { Text } from 'ink';
import { dimHex, neonGradientColor } from '../neon-gradient.js';

interface ModelsHintProps {
  config: AgentMeshConfig;
  dim?: boolean;
}

const DIM_FACTOR = 0.35;

const ROLES: Array<{
  label: string;
  t: number;
  field: 'architectModel' | 'workerModel';
}> = [
  { label: 'Architect', t: 0, field: 'architectModel' },
  { label: 'Worker', t: 1, field: 'workerModel' },
];

export function ModelsHint({ config, dim = false }: ModelsHintProps) {
  return (
    <Text>
      {ROLES.map(({ label, t, field }, index) => (
        <Text key={field}>
          {index > 0 ? '  ' : ''}
          <Text bold color={dim ? dimHex(neonGradientColor(t), DIM_FACTOR) : neonGradientColor(t)}>
            {label}
          </Text>
          <Text dimColor>: {config.models[field]}</Text>
        </Text>
      ))}
    </Text>
  );
}
