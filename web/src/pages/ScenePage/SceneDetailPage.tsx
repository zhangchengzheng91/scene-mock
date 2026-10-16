import { useEffect, useState } from "react";
import {
  Button,
  Card,
  Checkbox,
  Modal,
  Popconfirm,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import { api } from "../../api";
import MethodTag from "../../components/MethodTag";
import ResponseDrawer from "../../components/ResponseDrawer";
import {
  ApiItem,
  ConflictPayload,
  SceneDetail,
  SceneEntryView,
  isApiError,
} from "../../types";

export default function SceneDetailPage({
  pid,
  id,
  refresh,
  onConflict,
}: {
  pid: string;
  id: string;
  refresh: () => void;
  onConflict: (payload: ConflictPayload) => void;
}) {
  const [scene, setScene] = useState<SceneDetail | null>(null);
  const [apis, setApis] = useState<ApiItem[]>([]);
  const [editing, setEditing] = useState<SceneEntryView | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addApiId, setAddApiId] = useState<string>();

  const load = () => {
    if (!id) {
      return;
    }
    api
      .scene(pid, id)
      .then(setScene)
      .catch((err) => {
        message.error(isApiError(err) ? err.message : String(err));
      });
    api
      .apis(pid)
      .then(setApis)
      .catch(() => undefined);
  };

  useEffect(() => {
    load();
  }, [pid, id]);

  if (!scene) {
    return (
      <Card className="scene-expand" size="small">
        <div style={{ padding: 24, textAlign: "center" }}>
          <Spin />
        </div>
      </Card>
    );
  }

  const addable = apis.filter(
    (a) => !scene.entries.some((e) => e.apiId === a.id),
  );

  const toggleProxy = async (row: SceneEntryView, enabled: boolean) => {
    try {
      await api.upsertSceneApi(pid, scene.id, row.entryId, { enabled });
      load();
      refresh();
    } catch (err) {
      if (isApiError(err) && err.error === "scene_conflict") {
        onConflict(err.details as ConflictPayload);
        return;
      }
      message.error(isApiError(err) ? err.message : String(err));
    }
  };

  return (
    <Card className="scene-expand" size="small">
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Space
          style={{
            width: "100%",
            marginBottom: "8px",
          }}
        >
          <Button type="primary" onClick={() => setAddOpen(true)}>
            添加接口
          </Button>
        </Space>

        <Table
          className="scene-api-table"
          rowKey="entryId"
          size="small"
          scroll={{ x: "max-content" }}
          dataSource={scene.entries}
          pagination={false}
          columns={[
            {
              title: "",
              width: 40,
              align: "left",
              render: (_, row) => (
                <Checkbox
                  checked={scene.active && row.enabled}
                  onChange={(e) => toggleProxy(row, e.target.checked)}
                />
              ),
            },
            {
              title: "描述",
              dataIndex: "describe",
              align: "left",
              render: (value: string) => (
                <span style={{ whiteSpace: "nowrap" }}>{value || "-"}</span>
              ),
            },
            {
              title: "接口",
              align: "left",
              render: (_, row) => (
                <span>
                  <MethodTag method={row.method} />
                  <span style={{ marginLeft: "8px" }}>{row.url}</span>
                  <div>
                    <Typography.Text type="secondary">
                      {row.apiId} {row.desc}
                    </Typography.Text>
                  </div>
                </span>
              ),
            },
            {
              title: "status",
              dataIndex: "status",
              width: 80,
              align: "left",
            },
            {
              title: "PASS 关键字",
              dataIndex: "keyword",
              width: 240,
              align: "left",
              render: (value: string) =>
                value ? (
                  <Typography.Text copyable>{value}</Typography.Text>
                ) : (
                  "-"
                ),
            },
            { title: "delay", dataIndex: "delay", width: 80, align: "center" },
            {
              title: "variant",
              align: "left",
              render: (_, row) => (
                <span>
                  {row.unset && <Tag color="default">未设置返回值</Tag>}
                  {row.missing && <Tag color="red">缺文件</Tag>}
                  {!row.unset && !row.missing && (
                    <>
                      <Typography.Text code>{row.variant}</Typography.Text>
                      {row.refCount > 1 && (
                        <Tag style={{ marginLeft: 6 }}>
                          共享 ×{row.refCount}
                        </Tag>
                      )}
                    </>
                  )}
                </span>
              ),
            },
            {
              title: "操作",
              width: 240,
              align: "left",
              render: (_, row) => (
                <Space>
                  <Button size="small" onClick={() => setEditing(row)}>
                    编辑返回值
                  </Button>
                  <Button
                    size="small"
                    onClick={async () => {
                      try {
                        await api.duplicateSceneApi(pid, scene.id, row.entryId);
                        message.success("已复制，默认不开启 mock");
                        load();
                        refresh();
                      } catch (err) {
                        message.error(
                          isApiError(err) ? err.message : String(err),
                        );
                      }
                    }}
                  >
                    复制
                  </Button>
                  <Popconfirm
                    title="从本 Scene 移除该接口？（不删接口池和 data）"
                    onConfirm={async () => {
                      try {
                        await api.removeSceneApi(pid, scene.id, row.entryId);
                        load();
                        refresh();
                      } catch (err) {
                        message.error(
                          isApiError(err) ? err.message : String(err),
                        );
                      }
                    }}
                  >
                    <Button size="small" danger>
                      移除
                    </Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />

        <ResponseDrawer
          pid={pid}
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
              await api.upsertSceneApi(pid, scene.id, addApiId, {});
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
            style={{ width: "100%" }}
            placeholder="选择接口"
            value={addApiId}
            onChange={setAddApiId}
            options={addable.map((a) => ({
              value: a.id,
              label: `${a.method} ${a.url} (${a.id})`,
            }))}
          />
        </Modal>
      </Space>
    </Card>
  );
}
