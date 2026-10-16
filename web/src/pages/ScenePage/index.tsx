import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  Form,
  Input,
  Popconfirm,
  Select,
  Space,
  Table,
  Typography,
  message,
} from "antd";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../../api";
import CreateScene from "./CreateScene";
import SceneDetailPage from "./SceneDetailPage";
import {
  ConflictPayload,
  ProjectDetail,
  ProjectSummary,
  SceneListItem,
  Status,
  isApiError,
} from "../../types";

interface AllScenesRow extends SceneListItem {
  pid: string;
  projectName: string;
  projectHost: string;
}

export default function ScenesPage({
  status,
  refresh,
  onConflict,
}: {
  status: Status | null;
  refresh: () => void;
  onConflict: (payload: ConflictPayload) => void;
}) {
  const nav = useNavigate();
  const { pid: routePid = "" } = useParams();
  const [searchParams] = useSearchParams();
  const projectFilter = searchParams.get("project") || routePid || undefined;
  const [queryForm] = Form.useForm();
  const [rows, setRows] = useState<AllScenesRow[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [keyword, setKeyword] = useState("");
  const [copyFrom, setCopyFrom] = useState<AllScenesRow | null>(null);
  const [editing, setEditing] = useState<AllScenesRow | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);

  const runtimeKey = useMemo(() => {
    const map = status?.projects;
    if (!map) {
      return "";
    }
    return Object.entries(map)
      .map(([id, item]) => `${id}:${item.routeCount}:${item.activeScenes.join(",")}`)
      .join("|");
  }, [status?.projects]);

  const load = useCallback(() => {
    api.projects().then(async (list) => {
      setProjects(list);
      const settled = await Promise.allSettled(
        list.map(async (p) => {
          const scenes = await api.scenes(p.id);
          return scenes.map((s) => ({
            ...s,
            pid: p.id,
            projectName: p.name,
            projectHost: p.host,
          }));
        }),
      );
      const all: AllScenesRow[] = [];
      for (const r of settled) {
        if (r.status === "fulfilled") {
          all.push(...r.value);
        }
      }
      setRows(all);
    }).catch((err) => {
      if (!isApiError(err) || err.status !== 412) {
        message.error(isApiError(err) ? err.message : String(err));
      }
      setProjects([]);
      setRows([]);
    });
  }, []);

  useEffect(() => {
    load();
  }, [load, status?.ready, runtimeKey]);

  useEffect(() => {
    queryForm.setFieldsValue({ projectId: projectFilter });
  }, [projectFilter, queryForm]);

  useEffect(() => {
    if (!projectFilter) {
      setProject(null);
      return;
    }
    let cancelled = false;
    api.project(projectFilter).then((detail) => {
      if (!cancelled) {
        setProject(detail);
      }
    }).catch(() => {
      if (!cancelled) {
        setProject(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [projectFilter, status?.ready, runtimeKey]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return rows.filter((row) => {
      if (projectFilter && row.pid !== projectFilter) {
        return false;
      }
      if (!kw) {
        return true;
      }
      return (
        row.name.toLowerCase().includes(kw)
        || row.id.toLowerCase().includes(kw)
        || (row.desc || "").toLowerCase().includes(kw)
      );
    });
  }, [rows, projectFilter, keyword]);

  const searchScenes = (values: { projectId?: string; keyword?: string }) => {
    const nextProject = values.projectId || undefined;
    if (nextProject !== projectFilter) {
      setExpandedKeys([]);
    }
    setKeyword(String(values.keyword || "").trim());
    nav(
      nextProject ? `/scenes?project=${encodeURIComponent(nextProject)}` : "/scenes",
      { replace: true },
    );
  };

  const resetScenes = () => {
    queryForm.setFieldsValue({ projectId: undefined, keyword: "" });
    setKeyword("");
    setExpandedKeys([]);
    nav("/scenes", { replace: true });
  };

  const rowKey = (row: AllScenesRow) => `${row.pid}/${row.id}`;

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Card size="small">
        <Space style={{ width: "100%", justifyContent: "space-between" }} align="start">
          <Form
            form={queryForm}
            layout="inline"
            initialValues={{ projectId: projectFilter, keyword: "" }}
            onFinish={searchScenes}
          >
            <Form.Item name="projectId" label="项目名称">
              <Select
                allowClear
                style={{ width: 260 }}
                placeholder="全部项目"
                options={projects.map((p) => ({
                  value: p.id,
                  label: `${p.name}（${p.host || p.id}）`,
                }))}
              />
            </Form.Item>
            <Form.Item name="keyword" label="Scene 名称">
              <Input
                allowClear
                style={{ width: 240 }}
                placeholder="名称 / ID / 描述"
              />
            </Form.Item>
            <Form.Item>
              <Button type="primary" htmlType="submit">查询</Button>
            </Form.Item>
            <Form.Item>
              <Button onClick={resetScenes}>重置</Button>
            </Form.Item>
          </Form>
          <CreateScene
            pid={projectFilter || ""}
            projects={projects}
            copyFrom={copyFrom}
            onCopyClose={() => setCopyFrom(null)}
            editing={editing}
            onEditingClose={() => setEditing(null)}
            onCreated={() => {
              refresh();
              load();
            }}
          />
        </Space>
      </Card>

      {projectFilter && (
        <Card size="small">
          <Space size="large" wrap>
            <span>
              <Typography.Text type="secondary">项目名称：</Typography.Text>
              <Typography.Text strong>{project?.name || projectFilter}</Typography.Text>
            </span>
            {(project?.proxies?.length
              ? project.proxies
              : [{ host: project?.host || "", target: project?.target || "" }]
            ).map((item) => (
              <span key={item.host || "empty"}>
                <Typography.Text code>{item.host || "-"}</Typography.Text>
                <span style={{ margin: "0 6px" }}>→</span>
                <Typography.Text code>{item.target || "（走未命中策略）"}</Typography.Text>
              </span>
            ))}
          </Space>
        </Card>
      )}

      <Table
        rowKey={rowKey}
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
              pid={row.pid}
              id={row.id}
              refresh={refresh}
              onConflict={onConflict}
            />
          ),
        }}
        columns={[
          {
            title: "Scene",
            width: 160,
            render: (_, row) => (
              <span>
                <Typography.Text strong>{row.name}</Typography.Text>
                <div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {row.id}
                  </Typography.Text>
                </div>
              </span>
            ),
          },
          {
            title: "项目",
            width: 180,
            render: (_, row) => (
              <span>
                <Typography.Text strong>{row.projectName}</Typography.Text>
                <div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {row.projectHost || row.pid}
                  </Typography.Text>
                </div>
              </span>
            ),
          },
          {
            title: "接口",
            width: 90,
            render: (_, row) => `${row.active ? row.enabledCount : 0}/${row.apiCount}`,
          },
          {
            title: "最近修改",
            dataIndex: "mtimeMs",
            width: 180,
            render: (v: number) => (v ? new Date(v).toLocaleString() : "-"),
          },
          {
            title: "操作",
            width: 340,
            render: (_, row) => (
              <Space wrap onClick={(e) => e.stopPropagation()}>
                <Button size="small" onClick={() => {
                  setEditing(null);
                  setCopyFrom(row);
                }}>
                  复制
                </Button>
                <Button size="small" onClick={() => {
                  setCopyFrom(null);
                  setEditing(row);
                }}>
                  编辑
                </Button>
                <Button
                  size="small"
                  onClick={async () => {
                    try {
                      const r = await api.whistleRules();
                      await navigator.clipboard.writeText(r.text);
                      message.success("已复制 whistle 规则");
                    } catch (err) {
                      message.error(isApiError(err) ? err.message : String(err));
                    }
                  }}
                >
                  复制 whistle 规则
                </Button>
                <Popconfirm
                  title="删除这个 Scene？接口池和 data 文件会保留。"
                  onConfirm={async () => {
                    try {
                      const res: any = await api.deleteScene(row.pid, row.id);
                      if (res?.orphans?.length) {
                        message.info(
                          `已删除。残留孤立 variant ${res.orphans.length} 个，可在配置页清理。`,
                        );
                      } else {
                        message.success("已删除");
                      }
                      setExpandedKeys((keys) => keys.filter((k) => k !== rowKey(row)));
                      refresh();
                      load();
                    } catch (err) {
                      message.error(isApiError(err) ? err.message : String(err));
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

    </Space>
  );
}
