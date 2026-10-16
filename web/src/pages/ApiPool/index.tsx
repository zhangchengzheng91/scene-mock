import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  Form,
  Input,
  Select,
  Space,
  Table,
  Typography,
  message,
} from 'antd';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import MethodTag from '../../components/MethodTag';
import { ApiItem, ProjectSummary, Status, isApiError } from '../../types';
import CreateApi from './CreateApi';

interface Row extends ApiItem {
  pid: string;
  projectName: string;
  projectHost: string;
}

export default function AllApisPage({ status }: { status: Status | null }) {
  const nav = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const projectFilter = searchParams.get('project') || undefined;
  const [queryForm] = Form.useForm();
  const [rows, setRows] = useState<Row[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [keyword, setKeyword] = useState('');

  const load = useCallback(() => {
    api.projects().then(async (list) => {
      setProjects(list);
      const settled = await Promise.allSettled(
        list.map(async (p) => {
          const apis = await api.apis(p.id);
          return apis.map((a) => ({
            ...a,
            pid: p.id,
            projectName: p.name,
            projectHost: p.host,
          }));
        }),
      );
      const all: Row[] = [];
      for (const r of settled) {
        if (r.status === 'fulfilled') {
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
  }, [load, status?.ready]);

  useEffect(() => {
    queryForm.setFieldsValue({ projectId: projectFilter });
  }, [projectFilter, queryForm]);

  const searchApis = (values: { projectId?: string; keyword?: string }) => {
    setKeyword(String(values.keyword || '').trim());
    const next = new URLSearchParams(searchParams);
    if (values.projectId) next.set('project', values.projectId);
    else next.delete('project');
    setSearchParams(next, { replace: true });
  };

  const resetApis = () => {
    queryForm.setFieldsValue({ projectId: undefined, keyword: '' });
    setKeyword('');
    const next = new URLSearchParams(searchParams);
    next.delete('project');
    setSearchParams(next, { replace: true });
  };

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
        row.id.toLowerCase().includes(kw)
        || row.url.toLowerCase().includes(kw)
        || (row.desc || '').toLowerCase().includes(kw)
      );
    });
  }, [rows, projectFilter, keyword]);

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card size="small">
        <Space style={{ width: '100%', justifyContent: 'space-between' }} align="start">
          <Form
            form={queryForm}
            layout="inline"
            initialValues={{ projectId: projectFilter, keyword: '' }}
            onFinish={searchApis}
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
            <Form.Item name="keyword" label="接口">
              <Input
                allowClear
                style={{ width: 240 }}
                placeholder="ID / URL / 描述"
              />
            </Form.Item>
            <Form.Item>
              <Button type="primary" htmlType="submit">查询</Button>
            </Form.Item>
            <Form.Item>
              <Button onClick={resetApis}>重置</Button>
            </Form.Item>
          </Form>
          <CreateApi
            projects={projects}
            projectId={projectFilter}
            onCreated={load}
          />
        </Space>
      </Card>

      <Table
        rowKey={(row) => `${row.pid}/${row.id}`}
        size="middle"
        dataSource={filtered}
        pagination={false}
        columns={[
          {
            title: '项目',
            width: 200,
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
            title: 'Method',
            width: 90,
            render: (_, row) => <MethodTag method={row.method} />,
          },
          {
            title: 'URL',
            render: (_, row) => (
              <span>
                <Typography.Text code>{row.url}</Typography.Text>
                <div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {row.id}
                    {row.desc ? ` · ${row.desc}` : ''}
                  </Typography.Text>
                </div>
              </span>
            ),
          },
          {
            title: '被引用 Scene',
            width: 110,
            render: (_, row) => row.usedBy?.length ?? 0,
          },
          {
            title: '操作',
            width: 140,
            render: (_, row) => (
              <Button
                size="small"
                type="primary"
                onClick={() => nav(`/projects/${encodeURIComponent(row.pid)}/apis`)}
              >
                进入接口池
              </Button>
            ),
          },
        ]}
      />

    </Space>
  );
}
