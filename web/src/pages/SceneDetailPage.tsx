import { useEffect, useState } from 'react';
import {
  Button,
  Descriptions,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { useNavigate, useParams } from 'react-router-dom';
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
  refresh,
  onConflict,
}: {
  refresh: () => void;
  onConflict: (payload: ConflictPayload) => void;
}) {
  const { id = '' } = useParams();
  const nav = useNavigate();
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
    return null;
  }

  const addable = apis.filter((a) => !scene.entries.some((e) => e.apiId === a.id));

  const toggle = async (checked: boolean) => {
    try {
      if (checked) {
        await api.activate(scene.id);
      } else {
        await api.deactivate(scene.id);
      }
      refresh();
      load();
    } catch (err) {
      if (isApiError(err) && err.error === 'scene_conflict') {
        onConflict(err.details as ConflictPayload);
        return;
      }
      message.error(isApiError(err) ? err.message : String(err));
    }
  };

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Space style={{ width: '100%', justifyContent: 'space-between' }}>
        <Button onClick={() => nav('/scenes')}>返回列表</Button>
        <Space>
          <Button onClick={async () => {
            try {
              const r = await api.whistleRules();
              await navigator.clipboard.writeText(r.text);
              message.success('已复制 whistle 规则');
            } catch (err) {
              message.error(isApiError(err) ? err.message : String(err));
            }
          }}>复制 whistle 规则</Button>
          <Typography.Text type="secondary">激活</Typography.Text>
          <Switch checked={scene.active} onChange={toggle} />
          <Button onClick={() => {
            setMeta({ name: scene.name, desc: scene.desc || '' });
            setMetaOpen(true);
          }}>编辑信息</Button>
        </Space>
      </Space>

      <Descriptions bordered size="small" column={2}>
        <Descriptions.Item label="名称">{scene.name}</Descriptions.Item>
        <Descriptions.Item label="ID">{scene.id}</Descriptions.Item>
        <Descriptions.Item label="状态">
          {scene.active ? <Tag color="green">已激活</Tag> : <Tag>未激活</Tag>}
        </Descriptions.Item>
        <Descriptions.Item label="接口数">{scene.entries.length}</Descriptions.Item>
        <Descriptions.Item label="描述" span={2}>{scene.desc || '-'}</Descriptions.Item>
        <Descriptions.Item label="Scene 文件" span={2}>
          <Typography.Text copyable>{scene.filePath}</Typography.Text>
        </Descriptions.Item>
      </Descriptions>

      <Space style={{ width: '100%', justifyContent: 'space-between' }}>
        <Typography.Title level={5} style={{ margin: 0 }}>接口条目</Typography.Title>
        <Button type="primary" onClick={() => setAddOpen(true)}>添加接口</Button>
      </Space>

      <Table
        rowKey="apiId"
        size="middle"
        dataSource={scene.entries}
        pagination={false}
        columns={[
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
        onSaved={load}
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
  );
}
