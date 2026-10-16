import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Card,
  Modal,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api';
import { ProjectSummary, Status, isApiError } from '../../types';
import CreateProject from './CreateProject';

export default function ProjectsPage({
  status,
  refresh,
}: {
  status: Status | null;
  refresh: () => void | Promise<unknown>;
}) {
  const nav = useNavigate();
  const [list, setList] = useState<ProjectSummary[]>([]);
  const [editing, setEditing] = useState<ProjectSummary | null>(null);

  const load = useCallback(() => {
    api.projects().then(setList).catch((err) => {
      if (!isApiError(err) || err.status !== 412) {
        message.error(isApiError(err) ? err.message : String(err));
      }
      setList([]);
    });
  }, []);

  useEffect(() => {
    load();
  }, [load, status?.ready]);

  const remove = async (row: ProjectSummary) => {
    try {
      await api.deleteProject(row.id);
      message.success('已删除项目');
      await refresh();
      load();
    } catch (err) {
      if (isApiError(err) && err.error === 'confirm_required') {
        const removed = (err.details as {
          removed?: { scenes: number; apis: number; variants: number };
        })?.removed;
        Modal.confirm({
          title: `删除项目「${row.name}」？`,
          content: (
            <span>
              将删除整个 projects/{row.id}/ 目录：
              Scene {removed?.scenes ?? row.sceneCount} 个、
              接口 {removed?.apis ?? 0} 个、
              data variant {removed?.variants ?? 0} 个。
              该操作不可恢复。
            </span>
          ),
          okText: '确认删除',
          okButtonProps: { danger: true },
          onOk: async () => {
            try {
              await api.deleteProject(row.id, true);
              message.success('已删除项目');
              await refresh();
              load();
            } catch (e) {
              message.error(isApiError(e) ? e.message : String(e));
            }
          },
        });
        return;
      }
      message.error(isApiError(err) ? err.message : String(err));
    }
  };

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card style={{ width: '100%' }}>
        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
          <Typography.Text type="secondary">
            一个项目 = 一对域名（被代理的域名 → 代理到的域名）+ 一条 whistle 规则。
            切 Scene 不会改规则。各项目的 Scene 与接口池从对应行进入管理。
          </Typography.Text>
          <CreateProject
            list={list}
            editing={editing}
            onEditClose={() => setEditing(null)}
            onSaved={async () => {
              await refresh();
              load();
            }}
          />
        </Space>
      </Card>

      <Table
        rowKey="id"
        size="middle"
        dataSource={list}
        pagination={false}
        columns={[
          {
            title: '名称',
            width: 200,
            render: (_, row) => (
              <span>
                <Typography.Text strong>{row.name}</Typography.Text>
                <div>
                  <Typography.Text type="secondary">{row.id}</Typography.Text>
                </div>
              </span>
            ),
          },
          {
            title: '域名对（被代理 → 代理到）',
            render: (_, row) => {
              const pairs = row.proxies?.length
                ? row.proxies
                : [{ host: row.host, target: row.target }];
              return (
                <Space direction="vertical" size={4}>
                  {pairs.map((item) => (
                    <span key={item.host || 'empty'}>
                      <Typography.Text code>{item.host || '-'}</Typography.Text>
                      <span style={{ margin: '0 8px' }}>→</span>
                      <Typography.Text code>{item.target || '（走未命中策略）'}</Typography.Text>
                      <div>
                        <Typography.Text type="secondary">
                          规则：{item.host ? `${item.host} scene-mock://` : '无'}
                        </Typography.Text>
                      </div>
                    </span>
                  ))}
                </Space>
              );
            },
          },
          {
            title: 'Scene',
            width: 90,
            render: (_, row) => `${row.activeSceneCount}/${row.sceneCount}`,
          },
          {
            title: '路由',
            width: 70,
            dataIndex: 'routeCount',
          },
          {
            title: '状态',
            width: 90,
            render: (_, row) => (
              <Space size={4}>
                {row.hasError && <Tag color="red">有错误</Tag>}
              </Space>
            ),
          },
          {
            title: '操作',
            width: 280,
            render: (_, row) => (
              <Space wrap>
                <Button
                  size="small"
                  onClick={() => nav(`/scenes?project=${encodeURIComponent(row.id)}`)}
                >
                  Scene
                </Button>
                <Button
                  size="small"
                  onClick={() => nav(`/apis?project=${encodeURIComponent(row.id)}`)}
                >
                  接口池
                </Button>
                <Button size="small" onClick={() => setEditing(row)}>
                  编辑
                </Button>
                <Button size="small" danger onClick={() => remove(row)}>删除</Button>
              </Space>
            ),
          },
        ]}
      />

    </Space>
  );
}
