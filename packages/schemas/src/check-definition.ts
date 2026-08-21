import { z } from 'zod';

export const CheckDefinitionSchema = z.object({
  name: z.string(),
  command: z.string(),
  args: z.array(z.string()),
});

export type CheckDefinition = z.infer<typeof CheckDefinitionSchema>;
