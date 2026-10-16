import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Radio,
  Space,
  Typography,
  message,
} from 'antd';
import { api } from '../api';
import {
  GlobalConfig,
  Status,
  Workspace,
  isApiError,
} from '../types';

function linesOf(text: string): string[] {
  return text.split('\n').map((s) => s.trim()).filter(Boolean);
}

export default function ConfigPage({
  status,
  refresh,
}: {
  status: Status | null;
  refresh: () => void | Promise<unknown>;
}) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [pathInput, setPathInput] = useState('');
  const [config, setConfig] = useState<GlobalConfig | null>(null);
  const [rules, setRules] = useState('');
  const [patternsText, setPatternsText] = useState('/api/');

  const load = useCallback(() => {
    api.workspace().then((ws) => {
      setWorkspace(ws);
      setPathInput(ws.mocksRoot || '');
    }).catch(() => undefined);
    api.config().then((cfg) => {
      setConfig(cfg);
      setPatternsText((cfg.matchPatterns || []).join('\n'));
    }).catch(() => undefined);
    api.whistleRules().then((r) => setRules(r.text)).catch(() => undefined);
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

  const saveConfig = async () => {
    if (!config) {
      return;
    }
    try {
      await api.saveConfig({
        unmatched: config.unmatched,
        matchPatterns: linesOf(patternsText),
      });
      message.success('已保存，插件规则已更新');
      await refresh();
      load();
    } catch (err) {
      message.error(isApiError(err) ? err.message : String(err));
    }
  };

  const copyRules = async () => {
    try {
      await navigator.clipboard.writeText(rules);
      message.success('已复制');
    } catch {
      message.error('复制失败，请手动选择文本');
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

      <Card title="匹配规则">
        <Form layout="vertical">
          <Form.Item label="未命中时（项目未配「代理到的域名」时生效）">
            <Radio.Group
              value={config?.unmatched || 'passthrough'}
              onChange={(e) => config && setConfig({ ...config, unmatched: e.target.value })}
            >
              <Radio.Button value="passthrough">透传回源（默认）</Radio.Button>
              <Radio.Button value="404">明确 404</Radio.Button>
            </Radio.Group>
          </Form.Item>
          <Form.Item
            label="matchPatterns（写入插件 rules.txt，一行一个 Whistle pattern）"
            extra="与各项目 host 规则叠加。切 Scene / 切当前项目不会改这些规则。界面 Rules 优先级更高，若已有同类 pattern 请手动对齐。"
          >
            <Input.TextArea
              value={patternsText}
              onChange={(e) => setPatternsText(e.target.value)}
              autoSize={{ minRows: 3 }}
              spellCheck={false}
            />
          </Form.Item>
          <Button type="primary" onClick={saveConfig} disabled={!status?.ready}>保存配置</Button>
        </Form>
        <Typography.Title level={5}>Whistle 规则</Typography.Title>
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Alert
            type="success"
            showIcon
            message="插件已自动写入 rules.txt，一般不用粘贴"
            description="短协议 scene-mock:// 才会进入插件 server Hook。插件禁用后规则立即失效。"
          />
          <Input.TextArea value={rules} readOnly autoSize={{ minRows: 4 }} spellCheck={false} />
          <Button onClick={copyRules}>复制 whistle 规则</Button>
        </Space>
      </Card>

      <Card title="运行时">
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          {status?.httpsCapture != null && (
            <Alert
              type="info"
              showIcon
              message="HTTPS 抓包"
              description={(
                <Typography.Text>
                  业务若是 https，需在 Whistle 开启 HTTPS 抓包，插件才能看到明文 path。
                  当前 getHttpsStatus：
                  <Typography.Text code>
                    {JSON.stringify(status.httpsCapture)}
                  </Typography.Text>
                </Typography.Text>
              )}
            />
          )}
          {status?.unresolvedHosts?.length ? (
            <Alert
              type="warning"
              showIcon
              message={`${status.unresolvedHosts.length} 个未识别 host 已透传`}
              description={(
                <span>
                  这些 host 由 matchPatterns 带进插件，但不属于任何项目，未命中路由直接透传：
                  {status.unresolvedHosts.map((h) => (
                    <div key={h}><Typography.Text code>{h}</Typography.Text></div>
                  ))}
                </span>
              )}
            />
          ) : null}
          {status?.orphans?.length ? (
            <Alert
              type="warning"
              showIcon
              message={`存在 ${status.orphans.length} 个孤立 variant（没有任何 Scene 引用，不会自动删除）`}
              description={status.orphans.map((o) => (
                <div key={o.dataPath}>{o.dataPath}</div>
              ))}
            />
          ) : null}
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            建议不要把个人的 activeScenes 提交进主干。激活状态写在各项目的 project.json。
          </Typography.Paragraph>
        </Space>
      </Card>
    </Space>
  );
}
