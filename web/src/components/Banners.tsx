import type { ReactNode } from 'react';
import { Alert, Button, Space, Typography } from 'antd';
import { Link } from 'react-router-dom';
import { Status } from '../types';

export default function Banners({ status }: { status: Status | null }) {
  if (!status) {
    return null;
  }
  const items: ReactNode[] = [];
  if (!status.bound) {
    items.push(
      <Alert
        key="unbound"
        type="warning"
        showIcon
        message="尚未绑定工作区"
        description="请到配置页填写项目根目录（其下的 mocks/ 将作为数据目录）。未绑定前不会劫持请求。"
        action={(
          <Link to="/config">
            <Button size="small" type="primary">去配置</Button>
          </Link>
        )}
      />,
    );
  } else if (!status.ready) {
    items.push(
      <Alert
        key="not-ready"
        type="warning"
        showIcon
        message="mocks 尚未就绪"
        description="apis.json / config.json 未成功加载。可在配置页初始化骨架，或检查 JSON 是否合法。"
        action={(
          <Link to="/config">
            <Button size="small" type="primary">去配置</Button>
          </Link>
        )}
      />,
    );
  }
  if (status.errors?.length) {
    items.push(
      <Alert
        key="errors"
        type="error"
        showIcon
        message="热加载错误（已保留上一份合法内容继续服务）"
        description={(
          <Space direction="vertical" size={0}>
            {status.errors.map((err) => (
              <Typography.Text key={`${err.relativePath}:${err.reason}`} code>
                {err.relativePath}: {err.reason}
              </Typography.Text>
            ))}
          </Space>
        )}
      />,
    );
  }
  if (status.ambiguousRoutes?.length) {
    items.push(
      <Alert
        key="ambiguous"
        type="info"
        showIcon
        message="存在潜在路径歧义（按静态段更多 / 接口池注册顺序取值，不是 Scene 冲突）"
        description={status.ambiguousRoutes.map((r) => (
          <div key={`${r.method}${r.pattern}`}>
            {r.method} {r.pattern} → {r.apiIds.join(', ')}
          </div>
        ))}
      />,
    );
  }
  if (!items.length) {
    return null;
  }
  return <Space direction="vertical" style={{ width: '100%' }}>{items}</Space>;
}
