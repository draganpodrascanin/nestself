import { node } from '@nestself/eslint-config/node';

export default [
  { ignores: ['cdk.out/**'] },
  ...node,
];
