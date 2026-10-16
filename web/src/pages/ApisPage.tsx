import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Typography,
  message,
} from 'antd';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import MethodTag from '../components/MethodTag';
import AllApisPage from './ApiPool';
import { ApiItem, ProjectDetail, Status, isApiError } from '../types';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

export default function ApisPage({ status }: { status: Status | null }) {
  const { pid = '' } = useParams();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [list, setList] = useState<ApiItem[]>([]);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ApiItem | null>(null);
  const [form] = Form.useForm();
  const [renameOpen, setRenameOpen] = useState<ApiItem | null>(null);
  const [newId, setNewId] = useState('');

  const load = useCallback(() => {
    if (!pid) {
      return;
    }
    api.project(pid).then(setProject).catch(() => setProject(null));
    api.apis(pid).then(setList).catch((err) => {
      if (!isApiError(err) || (err.status !== 412 && err.status !== 404)) {
        message.error(isApiError(err) ? err.message : String(err));
      }
      setList([]);
    });
  }, [pid]);

  useEffect(() => {
    load();
  }, [load, status?.ready]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) {
      return list;
    }
    return list.filter((item) =>
      item.id.toLowerCase().includes(s)
      || item.url.toLowerCase().includes(s)
      || (item.desc || '').toLowerCase().includes(s)
      || item.method.toLowerCase().includes(s));
  }, [list, q]);

  const submit = async () => {
    if (!editing) {
      return;
    }
    const values = await form.validateFields();
    try {
      await api.updateApi(pid, editing.id, values);
      message.success('已更新');
      setOpen(false);
      setEditing(null);
      load();
    } catch (err) {
      message.error(isApiError(err) ? err.message : String(err));
    }
  };

  const remove = async (item: ApiItem, force: boolean) => {
    try {
      await api.deleteApi(pid, item.id, force);
      message.success('已删除');
      load();
    } catch (err) {
      if (isApiError(err) && err.error === 'api_in_use') {
        const usedBy = (err.details as { usedBy?: string[] })?.usedBy || [];
        Modal.confirm({
          title: '接口仍被 Scene 引用',
          content: `引用方：${usedBy.join(', ') || '未知'}。确认后将从这些 Scene 移除引用并删除 data/${item.id}/。`,
          okText: '确认删除',
          okButtonProps: { danger: true },
          onOk: () => remove(item, true),
        });
        return;
      }
      message.error(isApiError(err) ? err.message : String(err));
    }
  };

  if (!pid) {
    return <AllApisPage status={status} />;
  }

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card size="small">
        <Space size="large" wrap>
          <span>
            <Typography.Text type="secondary">项目名称：</Typography.Text>
            <Typography.Text strong>{project?.name || pid}</Typography.Text>
          </span>
          {(project?.proxies?.length
            ? project.proxies
            : [{ host: project?.host || '', target: project?.target || '' }]
          ).map((item) => (
            <span key={item.host || 'empty'}>
              <Typography.Text code>{item.host || '-'}</Typography.Text>
              <span style={{ margin: '0 6px' }}>→</span>
              <Typography.Text code>{item.target || '（走未命中策略）'}</Typography.Text>
            </span>
          ))}
          <Typography.Text type="secondary">
            接口池为项目级，仅在所属项目内生效。
          </Typography.Text>
        </Space>
      </Card>

      <Card style={{ width: '100%' }}>
        <Input.Search
          allowClear
          placeholder="搜索 method / URL / id / 描述"
          style={{ width: 320 }}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </Card>

      <Table
        rowKey="id"
        size="middle"
        dataSource={filtered}
        pagination={false}
        columns={[
          {
            title: 'Method',
            width: 90,
            render: (_, row) => <MethodTag method={row.method} />,
          },
          {
            title: 'URL 模式',
            dataIndex: 'url',
            render: (url, row) => (
              <span>
                <Typography.Text code>{url}</Typography.Text>
                <div>
                  <Typography.Text type="secondary">{row.id}</Typography.Text>
                </div>
              </span>
            ),
          },
          { title: '描述', dataIndex: 'desc' },
          {
            title: '被引用',
            width: 100,
            render: (_, row) => row.usedBy?.length || 0,
          },
          {
            title: '操作',
            width: 220,
            render: (_, row) => (
              <Space>
                <Button size="small" onClick={() => {
                  setEditing(row);
                  form.setFieldsValue(row);
                  setOpen(true);
                }}>编辑</Button>
                <Button size="small" onClick={() => {
                  setRenameOpen(row);
                  setNewId(row.id);
                }}>重命名</Button>
                <Popconfirm
                  title="删除该接口？"
                  onConfirm={() => remove(row, false)}
                >
                  <Button size="small" danger>删除</Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title="编辑接口"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={submit}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="id"
            label="id（稳定语义名，如 get-orders）"
            rules={[{ required: true }]}
          >
            <Input disabled={Boolean(editing)} />
          </Form.Item>
          <Form.Item name="method" label="method" rules={[{ required: true }]}>
            <Select options={METHODS.map((m) => ({ value: m, label: m }))} />
          </Form.Item>
          <Form.Item
            name="url"
            label="URL 模式（支持 :param）"
            rules={[{ required: true }]}
          >
            <Input placeholder="/api/users/:id" />
          </Form.Item>
          <Form.Item name="desc" label="描述">
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="重命名接口 id"
        open={Boolean(renameOpen)}
        onCancel={() => setRenameOpen(null)}
        onOk={async () => {
          if (!renameOpen) {
            return;
          }
          try {
            await api.updateApi(pid, renameOpen.id, { newId });
            message.success('已级联重命名 apis.json、Scene 引用与 data 目录');
            setRenameOpen(null);
            load();
          } catch (err) {
            message.error(isApiError(err) ? err.message : String(err));
          }
        }}
      >
        <Typography.Paragraph>
          将同时改动：apis.json、本项目所有 Scene 中的引用键、data/{renameOpen?.id}/ 目录名。
        </Typography.Paragraph>
        <Input value={newId} onChange={(e) => setNewId(e.target.value)} />
      </Modal>
    </Space>
  );
}
