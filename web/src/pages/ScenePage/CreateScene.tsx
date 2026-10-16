import { useEffect, useRef, useState } from "react";
import { Button, Form, Input, Modal, Select, Typography, message } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { api } from "../../api";
import { ProjectSummary, SceneListItem, isApiError } from "../../types";

export default function CreateScene({
  pid,
  projects,
  copyFrom,
  onCopyClose,
  editing = null,
  onEditingClose,
  onCreated,
}: {
  pid: string;
  projects: ProjectSummary[];
  copyFrom: (SceneListItem & { pid?: string }) | null;
  onCopyClose: () => void;
  editing?: (SceneListItem & { pid?: string }) | null;
  onEditingClose?: () => void;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const pending = useRef<Record<string, string | undefined> | null>(null);

  useEffect(() => {
    if (!copyFrom) {
      return;
    }
    pending.current = {
      projectId: copyFrom.pid || pid,
      id: `${copyFrom.id}-copy`,
      name: `${copyFrom.name} 副本`,
      desc: copyFrom.desc || "",
    };
    setOpen(true);
  }, [copyFrom, pid]);

  useEffect(() => {
    if (!editing) {
      return;
    }
    pending.current = {
      projectId: editing.pid || pid,
      id: editing.id,
      name: editing.name,
      desc: editing.desc || "",
    };
    setOpen(true);
  }, [editing, pid]);

  useEffect(() => {
    if (!open || !pending.current) {
      return;
    }
    form.resetFields();
    form.setFieldsValue(pending.current);
    pending.current = null;
  }, [open, copyFrom, editing, form]);

  const close = () => {
    setOpen(false);
    onCopyClose();
    onEditingClose?.();
  };

  const submit = async () => {
    let values: { projectId: string; id: string; name: string; desc?: string };
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    try {
      if (editing) {
        await api.updateScene(editing.pid || pid, editing.id, {
          name: values.name,
          desc: values.desc,
        });
        message.success("已更新");
        close();
        onCreated();
        return;
      }
      await api.createScene(values.projectId, {
        id: values.id,
        name: values.name,
        desc: values.desc,
        copyFrom: copyFrom?.id,
      });
      message.success("已创建 Scene");
      close();
      onCreated();
    } catch (err) {
      message.error(isApiError(err) ? err.message : String(err));
    }
  };

  return (
    <>
      <Button
        type="primary"
        icon={<PlusOutlined />}
        style={{ marginLeft: "8px" }}
        onClick={() => {
          onCopyClose();
          onEditingClose?.();
          const next = {
            projectId: pid || undefined,
            id: "",
            name: "",
            desc: "",
          };
          pending.current = next;
          if (open) {
            form.resetFields();
            form.setFieldsValue(next);
            pending.current = null;
            return;
          }
          setOpen(true);
        }}
      >
        新建 Scene
      </Button>
      <Modal
        title={
          editing
            ? "编辑 Scene 信息"
            : copyFrom
              ? `从「${copyFrom.name}」复制 Scene`
              : "新建 Scene"
        }
        open={open}
        onCancel={close}
        onOk={submit}
      >
        {copyFrom && (
          <Typography.Paragraph type="secondary">
            会为每个接口复制一份新的 data variant，默认隔离，不会共享源文件。
          </Typography.Paragraph>
        )}
        <Form form={form} layout="vertical">
          <Form.Item
            name="projectId"
            label="项目"
            rules={[{ required: true, message: "请选择项目" }]}
          >
            <Select
              placeholder="选择项目"
              disabled={Boolean(copyFrom || editing)}
              options={projects.map((p) => ({
                value: p.id,
                label: `${p.name}（${p.host || p.id}）`,
              }))}
            />
          </Form.Item>
          <Form.Item name="id" label="id" rules={[{ required: true, message: "请填写 id" }]}>
            <Input placeholder="normal-order" disabled={Boolean(editing)} />
          </Form.Item>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: "请填写名称" }]}>
            <Input placeholder="正常下单" />
          </Form.Item>
          <Form.Item name="desc" label="描述">
            <Input.TextArea placeholder="描述（可选）" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
