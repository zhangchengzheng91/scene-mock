import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Drawer,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Typography,
  message,
} from 'antd';
import { api } from '../api';
import { SceneEntryView, isApiError } from '../types';

export default function ResponseDrawer({
  sceneId,
  entry,
  open,
  onClose,
  onSaved,
}: {
  sceneId: string;
  entry: SceneEntryView | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form] = Form.useForm();
  const [bodyText, setBodyText] = useState('{}');
  const [saving, setSaving] = useState(false);
  const [variants, setVariants] = useState<{ variant: string; usedBy: string[] }[]>([]);

  useEffect(() => {
    if (!open || !entry) {
      return;
    }
    form.setFieldsValue({
      status: entry.status,
      delay: entry.delay,
      contentType: entry.headers['Content-Type']
        || entry.headers['content-type']
        || 'application/json',
    });
    setBodyText('{}');
    api.variants(entry.apiId).then((list: any[]) => {
      setVariants(list || []);
      const current = (list || []).find((v) => v.variant === entry.variant);
      if (current && current.body !== undefined) {
        setBodyText(JSON.stringify(current.body, null, 2));
      }
    }).catch(() => undefined);
  }, [open, entry, form]);

  const save = async () => {
    if (!entry) {
      return;
    }
    let body: unknown;
    try {
      body = JSON.parse(bodyText);
    } catch (err) {
      message.error(`JSON 无法解析：${(err as Error).message}`);
      return;
    }
    const values = await form.validateFields();
    setSaving(true);
    try {
      const result: any = await api.upsertSceneApi(sceneId, entry.apiId, {
        status: values.status,
        delay: values.delay,
        headers: { 'Content-Type': values.contentType },
        body,
      });
      if (result?.forked) {
        message.success(`已 fork 为 ${result.variant}，其它 Scene 不受影响`);
      } else {
        message.success('已保存，热加载生效');
      }
      onSaved();
      onClose();
    } catch (err) {
      message.error(isApiError(err) ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const formatJson = () => {
    try {
      setBodyText(JSON.stringify(JSON.parse(bodyText), null, 2));
    } catch (err) {
      message.error(`JSON 无法解析：${(err as Error).message}`);
    }
  };

  const share = async (variant: string) => {
    if (!entry) {
      return;
    }
    try {
      await api.shareSceneApi(sceneId, entry.apiId, variant);
      message.success(`已显式共享 ${variant}`);
      onSaved();
    } catch (err) {
      message.error(isApiError(err) ? err.message : String(err));
    }
  };

  return (
    <Drawer
      title={entry ? `编辑返回值 · ${entry.apiId}` : '编辑返回值'}
      width={560}
      open={open}
      onClose={onClose}
      extra={(
        <Space>
          <Button onClick={formatJson}>格式化 JSON</Button>
          <Button type="primary" loading={saving} onClick={save}>保存</Button>
        </Space>
      )}
    >
      {entry && (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          {entry.refCount > 1 && (
            <Alert
              type="warning"
              showIcon
              message={`此数据被 ${entry.refCount} 个 Scene 引用：${entry.usedBy.join(', ')}`}
              description="从面板保存 body 时会自动 fork 成新 variant，避免改 A 把 B 一起改掉。"
            />
          )}
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            Scene 文件写入 status / delay / headers；body 写入 data 文件。
            {entry.dataPath && (
              <>
                <br />
                data：<Typography.Text copyable>{entry.dataPath}</Typography.Text>
              </>
            )}
          </Typography.Paragraph>
          <Form form={form} layout="vertical">
            <Form.Item label="HTTP status" name="status">
              <InputNumber min={100} max={599} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="delay (ms)" name="delay">
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="Content-Type" name="contentType">
              <Input />
            </Form.Item>
          </Form>
          {variants.length > 0 && (
            <Form.Item label="显式共享已有 variant（不复制文件）">
              <Select
                allowClear
                placeholder="选择已有 variant"
                value={entry.variant}
                options={variants.map((v) => ({
                  value: v.variant,
                  label: `${v.variant}（${v.usedBy.length} 个 Scene）`,
                }))}
                onChange={(v) => v && share(v)}
              />
            </Form.Item>
          )}
          <Typography.Text strong>Body</Typography.Text>
          <Input.TextArea
            value={bodyText}
            onChange={(e) => setBodyText(e.target.value)}
            autoSize={{ minRows: 12, maxRows: 24 }}
            spellCheck={false}
            style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
          />
        </Space>
      )}
    </Drawer>
  );
}
