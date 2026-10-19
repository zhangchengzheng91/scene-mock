import { useEffect, useRef, useState } from 'react';
import { Button, Form, Input, Modal, Typography, message } from 'antd';
import { HolderOutlined, MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { api } from '../../api';
import { ProjectProxy, ProjectSummary, isApiError } from '../../types';

const emptyProxy = { host: undefined, target: 'scene-mock://' };

export default function CreateProject({
  list,
  editing,
  onEditClose,
  onSaved,
}: {
  list: ProjectSummary[];
  editing: ProjectSummary | null;
  onEditClose: () => void;
  onSaved: () => void | Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const pending = useRef<Record<string, unknown> | null>(null);
  const dragFrom = useRef<number | null>(null);

  useEffect(() => {
    if (!editing) {
      return;
    }
    const proxies = editing.proxies?.length
      ? editing.proxies.map((item) => ({ host: item.host, target: item.target }))
      : [{ host: editing.host, target: editing.target }];
    pending.current = {
      id: editing.id,
      name: editing.name,
      proxies,
    };
    setOpen(true);
  }, [editing]);

  useEffect(() => {
    if (!open || !pending.current) {
      return;
    }
    form.resetFields();
    form.setFieldsValue(pending.current);
    pending.current = null;
  }, [open, editing, form]);

  const close = () => {
    setOpen(false);
    onEditClose();
  };

  const openCreate = () => {
    onEditClose();
    pending.current = { id: undefined, name: undefined, proxies: [{ ...emptyProxy }] };
    if (open) {
      form.resetFields();
      form.setFieldsValue({ id: undefined, name: undefined, proxies: [{ ...emptyProxy }] });
      pending.current = null;
      return;
    }
    setOpen(true);
  };

  const submit = async () => {
    let values: { id: string; name: string; proxies: ProjectProxy[] };
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    const proxies = (values.proxies || []).map((item) => ({
      host: item.host,
      target: item.target,
    }));
    try {
      if (editing) {
        await api.updateProject(editing.id, {
          name: values.name,
          proxies,
        });
        message.success('已保存');
      } else {
        await api.createProject({ ...values, proxies });
        message.success('已创建项目');
      }
      close();
      await onSaved();
    } catch (err) {
      if (isApiError(err) && err.error === 'duplicate_host') {
        const details = err.details as { projectId?: string; index?: number; host?: string };
        const index = typeof details?.index === 'number' ? details.index : 0;
        const used = details?.projectId;
        form.setFields([{
          name: ['proxies', index, 'host'],
          errors: [used ? `该域名已被项目「${used}」使用` : '该域名在本组里重复'],
        }]);
        return;
      }
      if (isApiError(err) && err.error === 'duplicate_id') {
        form.setFields([{
          name: 'id',
          errors: ['该项目 ID 已存在'],
        }]);
        return;
      }
      message.error(isApiError(err) ? err.message : String(err));
    }
  };

  return (
    <>
      <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
        新建项目
      </Button>
      <Modal
        title={editing ? `编辑项目「${editing.name}」` : '新建项目'}
        open={open}
        width={780}
        onCancel={close}
        onOk={submit}
      >
        <Form form={form} layout="vertical">
          {editing && (
            <Typography.Paragraph type="secondary">
              只维护规则，不改 Scene 和接口。
            </Typography.Paragraph>
          )}
          <Form.Item name="name" label="项目名称" rules={[{ required: true }]}>
            <Input placeholder="请输入项目名称" />
          </Form.Item>
          <Form.Item
            name="id"
            label="项目 ID（用作 mock-data 文件夹名称）"
            tooltip="只能包含英文字母、数字、_、-，且以字母开头；全工作区唯一"
            rules={[
              { required: true, message: '项目 ID 不能为空' },
              {
                pattern: /^[a-zA-Z][a-zA-Z0-9_-]*$/,
                message: '只能包含英文字母、数字、_、-，且以字母开头',
              },
              {
                validator: (_, value) => {
                  const id = String(value || '').trim();
                  if (!editing && id && list.some((p) => p.id === id)) {
                    return Promise.reject(new Error(`项目 ID 已存在：${id}`));
                  }
                  return Promise.resolve();
                },
              },
            ]}
          >
            <Input
              placeholder="请输入项目 ID"
              spellCheck={false}
              disabled={Boolean(editing)}
            />
          </Form.Item>
          <Form.List name="proxies">
            {(fields, { add, remove, move }) => (
              <>
                {fields.map((field, index) => (
                  <div
                    key={field.key}
                    onDragOver={(event) => {
                      event.preventDefault();
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const from = dragFrom.current;
                      dragFrom.current = null;
                      if (from == null || from === index) {
                        return;
                      }
                      move(from, index);
                    }}
                    style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}
                  >
                    <span
                      role="button"
                      aria-label={`拖动第 ${index + 1} 条规则`}
                      draggable
                      title="拖动排序"
                      onDragStart={(event) => {
                        dragFrom.current = index;
                        event.dataTransfer.effectAllowed = 'move';
                        event.dataTransfer.setData('text/plain', String(index));
                      }}
                      onDragEnd={() => {
                        dragFrom.current = null;
                      }}
                      style={{
                        cursor: 'grab',
                        marginTop: index === 0 ? 38 : 8,
                        color: 'rgba(0, 0, 0, 0.45)',
                        display: 'inline-flex',
                      }}
                    >
                      <HolderOutlined />
                    </span>
                    <Form.Item
                      name={[field.name, 'host']}
                      label={index === 0 ? '规则' : ''}
                      tooltip={index === 0 ? 'Whistle pattern。只写域名时匹配该域名下全部请求。域名后可以再写路径，只匹配这一段及其子路径，例如 example.com/shop/api。同一域名上，路径更长的一组优先。' : undefined}
                      style={{ width: 320, marginBottom: 8 }}
                      rules={[{ required: true, message: '规则不能为空' }]}
                    >
                      <Input
                        placeholder="example.com/shop/api"
                        spellCheck={false}
                      />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, 'target']}
                      label={index === 0 ? '操作' : ''}
                      tooltip={index === 0 ? '原样写进规则右侧。scene-mock:// 把请求交给本插件；http(s) 地址同时作为未命中 Scene 时的转发目标。' : undefined}
                      style={{ width: 280, marginBottom: 8 }}
                    >
                      <Input
                        placeholder="scene-mock://"
                        spellCheck={false}
                      />
                    </Form.Item>
                    {fields.length > 1 && (
                      <MinusCircleOutlined
                        style={{ marginTop: index === 0 ? 38 : 8 }}
                        onClick={() => remove(field.name)}
                      />
                    )}
                  </div>
                ))}
                <Button
                  type="dashed"
                  block
                  icon={<PlusOutlined />}
                  style={{ marginBottom: 12 }}
                  onClick={() => add({ host: '', target: 'scene-mock://' })}
                >
                  添加一条规则
                </Button>
              </>
            )}
          </Form.List>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            一行一条规则，复制时按这里的顺序原样带上右侧操作。例如 <Typography.Text code>example.com/shop/api scene-mock://</Typography.Text>。未命中 Scene 时，接口（<Typography.Text code>/api</Typography.Text>，或域名路径下的 <Typography.Text code>/前缀/api</Typography.Text>）回到原始地址；操作是 http(s) 地址时，其余请求按浏览器里的路径转到该地址。操作留空或为 <Typography.Text code>scene-mock://</Typography.Text> 则走全局未命中策略。
          </Typography.Paragraph>
        </Form>
      </Modal>
    </>
  );
}
