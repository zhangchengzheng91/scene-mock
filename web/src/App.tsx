import { useCallback, useEffect, useState } from 'react';
import { ReloadOutlined } from '@ant-design/icons';
import { Button, ConfigProvider, Layout, Menu, Typography, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api, eventsUrl } from './api';
import Banners from './components/Banners';
import ConflictModal from './components/ConflictModal';
import ApisPage from './pages/ApisPage';
import ConfigPage from './pages/ConfigPage';
import SceneDetailPage from './pages/SceneDetailPage';
import ScenesPage from './pages/ScenesPage';
import {
  ActiveSetConflict,
  ConflictPayload,
  Status,
} from './types';

function Shell() {
  const loc = useLocation();
  const nav = useNavigate();
  const [status, setStatus] = useState<Status | null>(null);
  const [conflict, setConflict] = useState<ConflictPayload | ActiveSetConflict | null>(null);

  const refresh = useCallback(() => (
    api.status().then((s) => {
      setStatus(s);
      if (s.pendingConflict) {
        setConflict(s.pendingConflict);
      }
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

  const selected = loc.pathname.startsWith('/apis')
    ? 'apis'
    : loc.pathname.startsWith('/config')
      ? 'config'
      : 'scenes';

  return (
    <Layout className="app-shell">
      <Layout.Header className="app-header">
        <Typography.Text className="app-logo">scene-mock</Typography.Text>
        <Menu
          theme="dark"
          mode="horizontal"
          selectedKeys={[selected]}
          items={[
            { key: 'scenes', label: 'Scene 管理' },
            { key: 'apis', label: '接口池' },
            { key: 'config', label: '配置' },
          ]}
          onClick={(info) => {
            if (info.key === 'scenes') nav('/scenes');
            if (info.key === 'apis') nav('/apis');
            if (info.key === 'config') nav('/config');
          }}
        />
        <Button
          className="app-reload"
          type="text"
          icon={<ReloadOutlined />}
          onClick={() => location.reload()}
        >
          刷新
        </Button>
      </Layout.Header>
      <Layout.Content className="app-content">
        <Banners status={status} />
        <Routes>
          <Route path="/" element={<Navigate to="/scenes" replace />} />
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
            path="/scenes/:id"
            element={(
              <SceneDetailPage refresh={refresh} onConflict={setConflict} />
            )}
          />
          <Route path="/apis" element={<ApisPage status={status} />} />
          <Route
            path="/config"
            element={<ConfigPage status={status} refresh={refresh} />}
          />
        </Routes>
      </Layout.Content>
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
