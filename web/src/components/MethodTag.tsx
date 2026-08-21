import { Tag } from 'antd';

const COLORS: Record<string, string> = {
  GET: 'green',
  POST: 'blue',
  PUT: 'orange',
  PATCH: 'gold',
  DELETE: 'red',
  HEAD: 'default',
  OPTIONS: 'default',
};

export default function MethodTag({ method }: { method: string }) {
  const m = (method || '').toUpperCase();
  return <Tag color={COLORS[m] || 'default'}>{m || '-'}</Tag>;
}
