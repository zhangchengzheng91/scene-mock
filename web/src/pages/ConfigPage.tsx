import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Form,
  Input,
  Radio,
  Space,
  Typography,
  message,
} from 'antd';
import { api } from '../api';
import { AppConfig, Status, Workspace, isApiError } from '../types';

export default function ConfigPage({
  status,
  refresh,
}: {
  status: Status | null;
  refresh: () => void | Promise<unknown>;
}) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [pathInput, setPathInput] = useState('');
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [rules, setRules] = useState('');
  const [patternsText, setPatternsText] = useState('/api/');

  const load = () => {
    api.workspace().then((ws) => {
      setWorkspace(ws);
      setPathInput(ws.mocksRoot || '');
    }).catch(() => undefined);
    api.config().then((cfg) => {
      setConfig(cfg);
      setPatternsText((cfg.matchPatterns || []).join('\n'));
    }).catch(() => undefined);
    api.whistleRules().then((r) => setRules(r.text)).catch(() => undefined);
  };

  useEffect(() => {
    load();
  }, [status?.ready, status?.mocksRoot]);

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

  const save = async () => {
    if (!config) {
      return;
    }
    try {
      await api.saveConfig({
        proxyTarget: config.proxyTarget,
        unmatched: config.unmatched,
        matchPatterns: patternsText
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
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
      <Typography.Title level={5} style={{ margin: 0 }}>工作区</Typography.Title>
      <Typography.Paragraph type="secondary">
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
              ? 'apis.json / config.json 已加载'
              : '尚未就绪'
          }
        />
      )}

      <Typography.Title level={5} style={{ margin: 0 }}>Mock 行为</Typography.Title>
      <Form layout="vertical">
        <Form.Item
          label="proxyTarget（可选）"
          extra="未命中激活 Scene 时，把请求打到该 origin（保留 path/query/body）。留空则 passThrough 回浏览器原始地址。"
        >
          <Input
            placeholder="https://staging.example.com"
            value={config?.proxyTarget || ''}
            onChange={(e) => config && setConfig({ ...config, proxyTarget: e.target.value })}
          />
        </Form.Item>
        <Form.Item label="未命中时">
          <Radio.Group
            value={config?.unmatched || 'passthrough'}
            onChange={(e) => config && setConfig({ ...config, unmatched: e.target.value })}
          >
            <Radio.Button value="passthrough">透传回源（默认）</Radio.Button>
            <Radio.Button value="404">明确 404（需同时清空 proxyTarget）</Radio.Button>
          </Radio.Group>
        </Form.Item>
        <Form.Item
          label="matchPatterns（写入插件 rules.txt，一行一个 Whistle pattern）"
          extra="切 Scene 不会改这些规则。界面 Rules 优先级更高，若已有同类 pattern 请手动对齐。"
        >
          <Input.TextArea
            value={patternsText}
            onChange={(e) => setPatternsText(e.target.value)}
            autoSize={{ minRows: 3 }}
            spellCheck={false}
          />
        </Form.Item>
        <Button type="primary" onClick={save} disabled={!status?.ready}>保存配置</Button>
      </Form>

      <Typography.Title level={5} style={{ margin: 0 }}>Whistle 规则</Typography.Title>
      <Alert
        type="success"
        showIcon
        message="插件已自动写入 rules.txt，一般不用粘贴"
        description="短协议 scene-mock:// 才会进入插件 server Hook。插件禁用后规则立即失效。"
      />
      <Input.TextArea value={rules} readOnly autoSize={{ minRows: 4 }} spellCheck={false} />
      <Button onClick={copyRules}>复制 whistle 规则</Button>

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

      <Typography.Paragraph type="secondary">
        建议不要把个人的 activeScenes 提交进主干。激活状态写在 mocks/config.json。
      </Typography.Paragraph>
    </Space>
  );
}
