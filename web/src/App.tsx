import { useCallback, useEffect, useState } from 'react';
import {
  ApiOutlined,
  ClusterOutlined,
  FolderOutlined,
  ReloadOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { Button, ConfigProvider, Layout, Menu, Typography, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api, eventsUrl } from './api';
import Banners from './components/Banners';
import ConflictModal from './components/ConflictModal';
import AllApisPage from './pages/ApiPool';
import ConfigPage from './pages/ConfigPage';
import ProjectsPage from './pages/ProjectManager';
import ScenesPage from './pages/ScenePage';
import {
  ActiveSetConflict,
  ConflictPayload,
  Status,
} from './types';

const { Header, Sider, Content } = Layout;

const NAV_ITEMS = [
  { key: 'projects', icon: <FolderOutlined />, label: '项目管理' },
  { key: 'scenes', icon: <ClusterOutlined />, label: 'Scene 管理' },
  { key: 'apis', icon: <ApiOutlined />, label: '接口池' },
  { key: 'config', icon: <SettingOutlined />, label: '配置' },
] as const;

function pageTitle(pathname: string): string {
  if (pathname.startsWith('/config')) return '配置';
  if (pathname.endsWith('/apis')) return '接口池';
  if (pathname.endsWith('/scenes')) return 'Scene 管理';
  return '项目管理';
}

function Shell() {
  const loc = useLocation();
  const nav = useNavigate();
  const [status, setStatus] = useState<Status | null>(null);
  const [conflict, setConflict] = useState<ConflictPayload | ActiveSetConflict | null>(null);

  const refresh = useCallback(() => (
    api.status().then((s) => {
      setStatus(s);
      return s;
    }).catch(() => undefined)
  ), []);

  useEffect(() => {
    refresh();
    let es: EventSource | null = null;
    let poll: number | undefined;
    const connect = () => {
      es = new EventSource(eventsUrl());
      es.addEventListener('reload', () => refresh());
      es.addEventListener('error', () => refresh());
      es.addEventListener('conflict', (ev) => {
        try {
          setConflict(JSON.parse((ev as MessageEvent).data));
        } catch {
          refresh();
        }
      });
      es.onerror = () => {
        es?.close();
        poll = window.setTimeout(connect, 3000);
      };
    };
    connect();
    const fallback = window.setInterval(refresh, 8000);
    return () => {
      es?.close();
      window.clearTimeout(poll);
      window.clearInterval(fallback);
    };
  }, [refresh]);

  const selected = loc.pathname.startsWith('/config')
    ? 'config'
    : loc.pathname.endsWith('/apis')
      ? 'apis'
      : loc.pathname.endsWith('/scenes')
        ? 'scenes'
        : 'projects';

  return (
    <Layout className="app-shell">
      <Sider className="app-sider" theme="dark" width={220}>
        <Typography.Text className="app-logo">scene-mock</Typography.Text>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selected]}
          items={[...NAV_ITEMS]}
          onClick={(info) => {
            if (info.key === 'projects') nav('/projects');
            if (info.key === 'scenes') nav('/scenes');
            if (info.key === 'apis') nav('/apis');
            if (info.key === 'config') nav('/config');
          }}
        />
      </Sider>
      <Layout className="app-main">
        <Header className="app-header">
          <Typography.Title level={4} className="app-header-title">
            {pageTitle(loc.pathname)}
          </Typography.Title>
          <Button
            icon={<ReloadOutlined />}
            onClick={() => location.reload()}
          >
            刷新
          </Button>
        </Header>
        <Content className="app-content">
          <Banners status={status} />
          <Routes>
            <Route path="/" element={<Navigate to="/projects" replace />} />
            <Route
              path="/projects"
              element={<ProjectsPage status={status} refresh={refresh} />}
            />
            <Route
              path="/scenes"
              element={(
                <ScenesPage
                  status={status}
                  refresh={refresh}
                  onConflict={setConflict}
                />
              )}
            />
            <Route
              path="/projects/:pid/scenes"
              element={(
                <ScenesPage
                  status={status}
                  refresh={refresh}
                  onConflict={setConflict}
                />
              )}
            />
            <Route
              path="/apis"
              element={<AllApisPage status={status} />}
            />
            <Route
              path="/config"
              element={<ConfigPage status={status} refresh={refresh} />}
            />
            <Route path="*" element={<Navigate to="/projects" replace />} />
          </Routes>
        </Content>
      </Layout>
      <ConflictModal
        payload={conflict}
        onClose={() => setConflict(null)}
        onResolved={refresh}
      />
    </Layout>
  );
}

export default function App() {
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: { colorPrimary: '#1677ff', borderRadius: 6 },
      }}
    >
      <HashRouter>
        <Shell />
      </HashRouter>
    </ConfigProvider>
  );
}
