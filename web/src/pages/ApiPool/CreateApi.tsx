import { useEffect, useRef, useState } from 'react';
import { Button, Form, Input, Modal, Select, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { api } from '../../api';
import { ProjectSummary, isApiError } from '../../types';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

/** `/api/users/:id` → `ApiUsersId` */
function urlToPascalId(url: string): string {
  const path = url.trim().split(/[?#]/)[0];
  return path
    .split('/')
    .flatMap((segment) => segment.split(/[^A-Za-z0-9]+/))
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

export interface EditingApi {
  projectId: string;
  id: string;
  method: string;
  url: string;
  desc?: string;
}

export default function CreateApi({
  projects,
  projectId,
  onCreated,
  editing = null,
  onEditingClose,
}: {
  projects: ProjectSummary[];
  projectId?: string;
  onCreated: () => void;
  editing?: EditingApi | null;
  onEditingClose?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const pending = useRef<Record<string, string | undefined> | null>(null);
  const isEdit = Boolean(editing);
  const visible = open || isEdit;

  useEffect(() => {
    if (!editing) {
      return;
    }
    pending.current = {
      projectId: editing.projectId,
      method: editing.method,
      url: editing.url,
      id: editing.id,
      desc: editing.desc,
    };
  }, [editing]);

  useEffect(() => {
    if (!visible || !pending.current) {
      return;
    }
    form.resetFields();
    form.setFieldsValue(pending.current);
    pending.current = null;
  }, [visible, editing, form]);

  const close = () => {
    if (isEdit) {
      onEditingClose?.();
      return;
    }
    setOpen(false);
  };

  const openModal = () => {
    const next = {
      method: 'GET',
      projectId,
      id: undefined,
      url: undefined,
      desc: undefined,
    };
    pending.current = next;
    if (open) {
      form.resetFields();
      form.setFieldsValue(next);
      pending.current = null;
      return;
    }
    setOpen(true);
  };

  const submit = async () => {
    let values: { projectId: string; id: string; method: string; url: string; desc?: string };
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    if (editing) {
      try {
        const nextId = urlToPascalId(values.url);
        if (!nextId) {
          form.setFields([{ name: 'id', errors: ['无法从 URL 生成 id'] }]);
          return;
        }
        await api.updateApi(editing.projectId, editing.id, {
          method: values.method,
          url: values.url,
          desc: values.desc,
          ...(nextId !== editing.id ? { newId: nextId } : {}),
        });
        message.success('已更新');
        onEditingClose?.();
        onCreated();
      } catch (err) {
        message.error(isApiError(err) ? err.message : String(err));
      }
      return;
    }
    const id = urlToPascalId(values.url);
    if (!id) {
      form.setFields([{ name: 'id', errors: ['无法从 URL 生成 id'] }]);
      return;
    }
    try {
      await api.createApi(values.projectId, {
        id,
        method: values.method,
        url: values.url,
        desc: values.desc,
      });
      message.success('已注册');
      close();
      onCreated();
    } catch (err) {
      message.error(isApiError(err) ? err.message : String(err));
    }
  };

  return (
    <>
      <Button type="primary" icon={<PlusOutlined />} onClick={openModal}>
        注册接口
      </Button>
      <Modal title={isEdit ? '编辑接口' : '注册接口'} open={visible} onCancel={close} onOk={submit}>
        <Form
          form={form}
          layout="vertical"
          onValuesChange={(changed) => {
            if (!Object.prototype.hasOwnProperty.call(changed, 'url')) {
              return;
            }
            form.setFieldsValue({ id: urlToPascalId(String(changed.url || '')) });
          }}
        >
          <Form.Item
            name="projectId"
            label="项目"
            rules={[{ required: true, message: '请选择项目' }]}
          >
            <Select
              disabled={isEdit}
              placeholder="选择项目"
              options={projects.map((p) => ({
                value: p.id,
                label: `${p.name}（${p.host || p.id}）`,
              }))}
            />
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
          <Form.Item name="id" label="id">
            <Input disabled />
          </Form.Item>
          <Form.Item name="desc" label="描述">
            <Input.TextArea />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
