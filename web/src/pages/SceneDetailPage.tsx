import { useEffect, useState } from 'react';
import {
  Button,
  Card,
  Checkbox,
  Descriptions,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { api } from '../api';
import MethodTag from '../components/MethodTag';
import ResponseDrawer from '../components/ResponseDrawer';
import {
  ApiItem,
  ConflictPayload,
  SceneDetail,
  SceneEntryView,
  SceneListItem,
  isApiError,
} from '../types';

export default function SceneDetailPage({
  id,
  refresh,
  onConflict,
}: {
  id: string;
  refresh: () => void;
  onConflict: (payload: ConflictPayload) => void;
}) {
  const [scene, setScene] = useState<SceneDetail | null>(null);
  const [apis, setApis] = useState<ApiItem[]>([]);
  const [scenes, setScenes] = useState<SceneListItem[]>([]);
  const [editing, setEditing] = useState<SceneEntryView | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addApiId, setAddApiId] = useState<string>();
  const [copyApi, setCopyApi] = useState<SceneEntryView | null>(null);
  const [fromSceneId, setFromSceneId] = useState<string>();
  const [metaOpen, setMetaOpen] = useState(false);
  const [meta, setMeta] = useState({ name: '', desc: '' });

  const load = () => {
    if (!id) {
      return;
    }
    api.scene(id).then(setScene).catch((err) => {
      message.error(isApiError(err) ? err.message : String(err));
    });
    api.apis().then(setApis).catch(() => undefined);
    api.scenes().then(setScenes).catch(() => undefined);
  };

  useEffect(() => {
    load();
  }, [id]);

  if (!scene) {
    return (
      <Card className="scene-expand" size="small">
        <div style={{ padding: 24, textAlign: 'center' }}>
          <Spin />
        </div>
      </Card>
    );
  }

  const addable = apis.filter((a) => !scene.entries.some((e) => e.apiId === a.id));

  const toggleProxy = async (row: SceneEntryView, enabled: boolean) => {
    try {
      await api.upsertSceneApi(scene.id, row.apiId, { enabled });
      load();
      refresh();
    } catch (err) {
      if (isApiError(err) && err.error === 'scene_conflict') {
        onConflict(err.details as ConflictPayload);
        return;
      }
      message.error(isApiError(err) ? err.message : String(err));
    }
  };

  return (
    <Card className="scene-expand" size="small">
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Space style={{ width: '100%', justifyContent: 'space-between' }}>
        <Descriptions bordered size="small" column={2} style={{ flex: 1 }}>
          <Descriptions.Item label="描述" span={2}>{scene.desc || '-'}</Descriptions.Item>
          <Descriptions.Item label="Scene 文件" span={2}>
            <Typography.Text copyable>{scene.filePath}</Typography.Text>
          </Descriptions.Item>
        </Descriptions>
        <Space direction="vertical">
          <Button onClick={() => {
            setMeta({ name: scene.name, desc: scene.desc || '' });
            setMetaOpen(true);
          }}>编辑信息</Button>
          <Button onClick={async () => {
            try {
              const r = await api.whistleRules();
              await navigator.clipboard.writeText(r.text);
              message.success('已复制 whistle 规则');
            } catch (err) {
              message.error(isApiError(err) ? err.message : String(err));
            }
          }}>复制 whistle 规则</Button>
        </Space>
      </Space>

      <Space style={{ width: '100%', justifyContent: 'space-between' }}>
        <Typography.Title level={5} style={{ margin: 0 }}>接口条目</Typography.Title>
        <Button type="primary" onClick={() => setAddOpen(true)}>添加接口</Button>
      </Space>

      <Table
        className="scene-api-table"
        rowKey="apiId"
        size="small"
        scroll={{ x: 'max-content' }}
        dataSource={scene.entries}
        pagination={false}
        columns={[
          {
            title: '',
            width: 40,
            align: 'center',
            render: (_, row) => (
              <Checkbox
                checked={scene.active && row.enabled}
                onChange={(e) => toggleProxy(row, e.target.checked)}
              />
            ),
          },
          {
            title: '描述',
            dataIndex: 'describe',
            render: (value: string) => (
              <span style={{ whiteSpace: 'nowrap' }}>{value || '-'}</span>
            ),
          },
          {
            title: '接口',
            render: (_, row) => (
              <span>
                <MethodTag method={row.method} />
                {row.url}
                <div>
                  <Typography.Text type="secondary">{row.apiId} {row.desc}</Typography.Text>
                </div>
              </span>
            ),
          },
          { title: 'status', dataIndex: 'status', width: 80 },
          {
            title: 'PASS 关键字',
            dataIndex: 'keyword',
            width: 240,
            render: (value: string) => (
              value
                ? (
                  <Typography.Text copyable>
                    {value}
                  </Typography.Text>
                )
                : '-'
            ),
          },
          { title: 'delay', dataIndex: 'delay', width: 80 },
          {
            title: 'variant',
            render: (_, row) => (
              <span>
                {row.unset && <Tag color="default">未设置返回值</Tag>}
                {row.missing && <Tag color="red">缺文件</Tag>}
                {!row.unset && !row.missing && (
                  <>
                    <Typography.Text code>{row.variant}</Typography.Text>
                    {row.refCount > 1 && <Tag style={{ marginLeft: 6 }}>共享 ×{row.refCount}</Tag>}
                  </>
                )}
              </span>
            ),
          },
          {
            title: '操作',
            width: 260,
            render: (_, row) => (
              <Space>
                <Button size="small" onClick={() => setEditing(row)}>编辑返回值</Button>
                <Button size="small" onClick={() => {
                  setCopyApi(row);
                  setFromSceneId(undefined);
                }}>从其它 Scene 复制</Button>
                <Popconfirm
                  title="从本 Scene 移除该接口？（不删接口池和 data）"
                  onConfirm={async () => {
                    try {
                      await api.removeSceneApi(scene.id, row.apiId);
                      load();
                      refresh();
                    } catch (err) {
                      message.error(isApiError(err) ? err.message : String(err));
                    }
                  }}
                >
                  <Button size="small" danger>移除</Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <ResponseDrawer
        sceneId={scene.id}
        entry={editing}
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        onSaved={() => {
          load();
          refresh();
        }}
      />

      <Modal
        title="从接口池添加"
        open={addOpen}
        onCancel={() => setAddOpen(false)}
        onOk={async () => {
          if (!addApiId) {
            return;
          }
          try {
            await api.upsertSceneApi(scene.id, addApiId, {});
            setAddOpen(false);
            setAddApiId(undefined);
            load();
            refresh();
          } catch (err) {
            message.error(isApiError(err) ? err.message : String(err));
          }
        }}
      >
        <Select
          showSearch
          style={{ width: '100%' }}
          placeholder="选择接口"
          value={addApiId}
          onChange={setAddApiId}
          options={addable.map((a) => ({
            value: a.id,
            label: `${a.method} ${a.url} (${a.id})`,
          }))}
        />
      </Modal>

      <Modal
        title="复制其它 Scene 的返回值"
        open={Boolean(copyApi)}
        onCancel={() => setCopyApi(null)}
        onOk={async () => {
          if (!copyApi || !fromSceneId) {
            return;
          }
          try {
            await api.copySceneApi(scene.id, copyApi.apiId, fromSceneId);
            message.success('已复制为新 variant');
            setCopyApi(null);
            load();
            refresh();
          } catch (err) {
            message.error(isApiError(err) ? err.message : String(err));
          }
        }}
      >
        <Select
          style={{ width: '100%' }}
          placeholder="选择源 Scene"
          value={fromSceneId}
          onChange={setFromSceneId}
          options={scenes
            .filter((s) => s.id !== scene.id)
            .map((s) => ({ value: s.id, label: s.name }))}
        />
      </Modal>

      <Modal
        title="编辑 Scene 信息"
        open={metaOpen}
        onCancel={() => setMetaOpen(false)}
        onOk={async () => {
          try {
            await api.updateScene(scene.id, meta);
            setMetaOpen(false);
            load();
            refresh();
          } catch (err) {
            message.error(isApiError(err) ? err.message : String(err));
          }
        }}
      >
        <Form layout="vertical">
          <Form.Item label="名称">
            <Input value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} />
          </Form.Item>
          <Form.Item label="描述">
            <Input.TextArea
              value={meta.desc}
              onChange={(e) => setMeta({ ...meta, desc: e.target.value })}
            />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
    </Card>
  );
}
