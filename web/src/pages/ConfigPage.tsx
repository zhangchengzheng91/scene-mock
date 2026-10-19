import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Input,
  Space,
  Typography,
  message,
} from 'antd';
import { api } from '../api';
import {
  Status,
  Workspace,
  isApiError,
} from '../types';

export default function ConfigPage({
  status,
  refresh,
}: {
  status: Status | null;
  refresh: () => void | Promise<unknown>;
}) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [pathInput, setPathInput] = useState('');

  const load = useCallback(() => {
    api.workspace().then((ws) => {
      setWorkspace(ws);
      setPathInput(ws.mocksRoot || '');
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
  }, [load, status?.ready, status?.mocksRoot]);

  const bind = async () => {
    try {
      await api.bindWorkspace(pathInput);
      message.success('已绑定');
      await refresh();
      load();
    } catch (err) {
      message.error(isApiError(err) ? err.message : String(err));
    }
  };

  const init = async () => {
    try {
      await api.initWorkspace();
      message.success('已写入 mocks 骨架');
      await refresh();
      load();
    } catch (err) {
      message.error(isApiError(err) ? err.message : String(err));
    }
  };

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card title="工作区">
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            填写业务仓库根目录或其中的 mocks 目录。数据只存在该目录的 JSON 文件里，可随 git 共享。
            插件无法打开系统文件框，请粘贴绝对路径。
          </Typography.Paragraph>
          <Space.Compact style={{ width: '100%' }}>
            <Input
              value={pathInput}
              placeholder="/abs/path/to/project 或 .../mocks"
              onChange={(e) => setPathInput(e.target.value)}
            />
            <Button type="primary" onClick={bind}>绑定</Button>
            <Button onClick={init} disabled={!workspace?.bound}>初始化骨架</Button>
          </Space.Compact>
          {workspace?.recent?.length ? (
            <Space wrap>
              <Typography.Text type="secondary">最近：</Typography.Text>
              {workspace.recent.map((p) => (
                <Button key={p} size="small" onClick={() => setPathInput(p)}>{p}</Button>
              ))}
            </Space>
          ) : null}
          {(status?.mocksRoot || workspace?.mocksRoot) && (
            <Alert
              type="info"
              showIcon
              message={`当前监听：${status?.mocksRoot || workspace?.mocksRoot}`}
              description={
                (status?.ready ?? workspace?.ready)
                  ? 'config.json 与 projects/ 已加载'
                  : '尚未就绪'
              }
            />
          )}
        </Space>
      </Card>
    </Space>
  );
}
