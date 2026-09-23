import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  Col,
  Form,
  Input,
  Modal,
  Popconfirm,
  Row,
  Space,
  Statistic,
  Switch,
  Table,
  Typography,
  message,
} from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { api } from "../../api";
import SceneDetailPage from "./SceneDetailPage";
import {
  ConflictPayload,
  SceneListItem,
  Status,
  isApiError,
} from "../../types";

export default function ScenesPage({
  status,
  refresh,
  onConflict,
}: {
  status: Status | null;
  refresh: () => void;
  onConflict: (payload: ConflictPayload) => void;
}) {
  const [scenes, setScenes] = useState<SceneListItem[]>([]);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [copyFrom, setCopyFrom] = useState<SceneListItem | null>(null);
  const [form, setForm] = useState({ id: "", name: "", desc: "" });
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [metaOpen, setMetaOpen] = useState(false);
  const [meta, setMeta] = useState({ id: "", name: "", desc: "" });

  const load = () => {
    api
      .scenes()
      .then(setScenes)
      .catch((err) => {
        if (!isApiError(err) || err.status !== 412) {
          message.error(isApiError(err) ? err.message : String(err));
        }
        setScenes([]);
      });
  };

  useEffect(() => {
    load();
  }, [status?.routeCount, status?.activeCount, status?.ready]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) {
      return scenes;
    }
    return scenes.filter(
      (item) =>
        item.name.toLowerCase().includes(s) ||
        item.id.toLowerCase().includes(s) ||
        (item.desc || "").toLowerCase().includes(s),
    );
  }, [scenes, q]);

  const toggle = async (scene: SceneListItem, checked: boolean) => {
    try {
      await api.setSceneProxies(scene.id, checked);
      message.success(
        checked
          ? `已激活 ${scene.name} 全部代理`
          : `已关闭 ${scene.name} 全部代理`,
      );
      refresh();
      load();
    } catch (err) {
      if (isApiError(err) && err.error === "scene_conflict") {
        onConflict(err.details as ConflictPayload);
        return;
      }
      message.error(isApiError(err) ? err.message : String(err));
    }
  };

  const submit = async () => {
    try {
      await api.createScene({
        ...form,
        copyFrom: copyFrom?.id,
      });
      message.success("已创建 Scene");
      setOpen(false);
      setCopyFrom(null);
      setForm({ id: "", name: "", desc: "" });
      refresh();
      load();
    } catch (err) {
      message.error(isApiError(err) ? err.message : String(err));
    }
  };

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Row gutter={12}>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="Scene 总数"
              value={status?.sceneCount ?? scenes.length}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title="已激活" value={status?.activeCount ?? 0} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title="接口总数" value={status?.apiCount ?? 0} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="当前冲突"
              value={status?.pendingConflict ? 1 : 0}
              valueStyle={{
                color: status?.pendingConflict ? "#cf1322" : undefined,
              }}
            />
          </Card>
        </Col>
      </Row>

      <Card style={{ width: "100%", justifyContent: "space-between" }}>
        <Input.Search
          allowClear
          placeholder="搜索 Scene 名称 / id"
          style={{ width: 280 }}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Button
          type="primary"
          icon={<PlusOutlined />}
          style={{ marginLeft: "8px" }}
          onClick={() => {
            setCopyFrom(null);
            setOpen(true);
          }}
        >
          新建 Scene
        </Button>
      </Card>

      <Table
        rowKey="id"
        size="middle"
        dataSource={filtered}
        pagination={false}
        expandable={{
          expandedRowKeys: expandedKeys,
          onExpandedRowsChange: (keys) => setExpandedKeys(keys.map(String)),
          expandRowByClick: true,
          expandedRowClassName: "scene-expand-row",
          expandedRowRender: (row) => (
            <SceneDetailPage
              id={row.id}
              refresh={refresh}
              onConflict={onConflict}
            />
          ),
        }}
        columns={[
          {
            title: "名称",
            dataIndex: "name",
            width: 110,
            render: (name, row) => (
              <span>
                <Typography.Text strong>{name}</Typography.Text>
                <div>
                  <Typography.Text type="secondary">{row.id}</Typography.Text>
                </div>
              </span>
            ),
          },
          {
            title: "接口",
            width: 110,
            render: (_, row) =>
              `${row.active ? row.enabledCount : 0}/${row.apiCount}`,
          },
          {
            title: "激活",
            width: 100,
            render: (_, row) => (
              <span onClick={(e) => e.stopPropagation()}>
                <Switch
                  checked={
                    row.apiCount === 0
                      ? row.active
                      : row.active && row.enabledCount > 0
                  }
                  onChange={(checked) => toggle(row, checked)}
                />
              </span>
            ),
          },
          {
            title: "最近修改",
            dataIndex: "mtimeMs",
            width: 180,
            render: (v: number) => (v ? new Date(v).toLocaleString() : "-"),
          },
          {
            title: "操作",
            width: 180,
            render: (_, row) => (
              <Space onClick={(e) => e.stopPropagation()}>
                <Button
                  size="small"
                  onClick={() => {
                    setCopyFrom(row);
                    setForm({
                      id: `${row.id}-copy`,
                      name: `${row.name} 副本`,
                      desc: row.desc || "",
                    });
                    setOpen(true);
                  }}
                >
                  复制
                </Button>
                <Button
                  size="small"
                  onClick={() => {
                    setMeta({
                      id: row.id,
                      name: row.name,
                      desc: row.desc || "",
                    });
                    setMetaOpen(true);
                  }}
                >
                  编辑信息
                </Button>
                <Button
                  size="small"
                  onClick={async () => {
                    try {
                      const r = await api.whistleRules();
                      await navigator.clipboard.writeText(r.text);
                      message.success("已复制 whistle 规则");
                    } catch (err) {
                      message.error(
                        isApiError(err) ? err.message : String(err),
                      );
                    }
                  }}
                >
                  复制 whistle 规则
                </Button>
                <Popconfirm
                  title="删除这个 Scene？接口池和 data 文件会保留。"
                  onConfirm={async () => {
                    try {
                      const res: any = await api.deleteScene(row.id);
                      if (res?.orphans?.length) {
                        message.info(
                          `已删除。残留孤立 variant ${res.orphans.length} 个，可在配置页清理。`,
                        );
                      } else {
                        message.success("已删除");
                      }
                      setExpandedKeys((keys) =>
                        keys.filter((k) => k !== row.id),
                      );
                      refresh();
                      load();
                    } catch (err) {
                      message.error(
                        isApiError(err) ? err.message : String(err),
                      );
                    }
                  }}
                >
                  <Button size="small" danger>
                    删除
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title={copyFrom ? `从「${copyFrom.name}」复制 Scene` : "新建 Scene"}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={submit}
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          {copyFrom && (
            <Typography.Paragraph type="secondary">
              会为每个接口复制一份新的 data variant，默认隔离，不会共享源文件。
            </Typography.Paragraph>
          )}
          <Input
            addonBefore="id"
            placeholder="normal-order"
            value={form.id}
            onChange={(e) => setForm({ ...form, id: e.target.value })}
          />
          <Input
            addonBefore="名称"
            placeholder="正常下单"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <Input.TextArea
            placeholder="描述（可选）"
            value={form.desc}
            onChange={(e) => setForm({ ...form, desc: e.target.value })}
          />
        </Space>
      </Modal>

      <Modal
        title="编辑 Scene 信息"
        open={metaOpen}
        onCancel={() => setMetaOpen(false)}
        onOk={async () => {
          try {
            await api.updateScene(meta.id, {
              name: meta.name,
              desc: meta.desc,
            });
            setMetaOpen(false);
            refresh();
            load();
          } catch (err) {
            message.error(isApiError(err) ? err.message : String(err));
          }
        }}
      >
        <Form layout="vertical">
          <Form.Item label="名称">
            <Input
              value={meta.name}
              onChange={(e) => setMeta({ ...meta, name: e.target.value })}
            />
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
