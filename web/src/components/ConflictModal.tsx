import { Button, Modal, Table, Typography } from 'antd';
import MethodTag from './MethodTag';
import { ActiveSetConflict, ConflictPayload, isApiError } from '../types';
import { api } from '../api';

type Payload = ConflictPayload | ActiveSetConflict;

export default function ConflictModal({
  payload,
  onClose,
  onResolved,
}: {
  payload: Payload | null;
  onClose: () => void;
  onResolved: () => void;
}) {
  const isActivate = payload?.error === 'scene_conflict';

  const resolve = async (action: 'keep-new' | 'keep-old' | 'replace') => {
    try {
      if (action === 'replace' && payload?.error === 'active_set_conflict') {
        const first = payload.involvedScenes[0];
        await api.resolveActivate({
          action: 'replace',
          activeScenes: first ? [first.id] : [],
        });
      } else if (payload?.error === 'scene_conflict') {
        await api.resolveActivate({
          sceneId: payload.incoming.id,
          action: action === 'keep-new' ? 'keep-new' : 'keep-old',
        });
      }
      onResolved();
      onClose();
    } catch (err) {
      Modal.error({
        title: '处理冲突失败',
        content: isApiError(err) ? err.message : String(err),
      });
    }
  };

  return (
    <Modal
      open={Boolean(payload)}
      title="Scene 接口冲突"
      width={760}
      onCancel={() => {
        if (isActivate) {
          resolve('keep-old');
        } else {
          onClose();
        }
      }}
      footer={isActivate ? (
        <>
          <Button onClick={() => resolve('keep-old')}>保持现状</Button>
          <Button type="primary" onClick={() => resolve('keep-new')}>
            激活新 Scene（关闭冲突的旧 Scene）
          </Button>
        </>
      ) : (
        <>
          <Button onClick={onClose}>稍后处理</Button>
          <Button type="primary" onClick={() => resolve('replace')}>
            只保留列表中的第一个 Scene
          </Button>
        </>
      )}
    >
      {payload?.error === 'scene_conflict' && (
        <Typography.Paragraph>
          激活「{payload.incoming.name}」会与已激活 Scene 在下列接口上重合。
          冲突按 Scene 整组二选一，不会按接口拆开叠加。
        </Typography.Paragraph>
      )}
      {payload?.error === 'active_set_conflict' && (
        <Typography.Paragraph>
          当前激活集合自身已冲突（可能来自手改或 git merge）。
          解决前不会对外提供歧义 mock，全部走透传。
          涉及：{payload.involvedScenes.map((s) => s.name).join('、')}
        </Typography.Paragraph>
      )}
      <Table
        size="small"
        rowKey={(row) => `${row.apiId}-${row.existingScene.id}`}
        pagination={false}
        dataSource={payload?.conflicts || []}
        columns={[
          {
            title: '接口',
            render: (_, row) => (
              <span>
                <MethodTag method={row.method} />
                {row.url}
                <Typography.Text type="secondary"> ({row.apiId})</Typography.Text>
              </span>
            ),
          },
          {
            title: '已激活',
            render: (_, row) => (
              <div>
                <div>{row.existingScene.name} · {row.existingScene.status}</div>
                <Typography.Text type="secondary" code>
                  {row.existingScene.preview}
                </Typography.Text>
              </div>
            ),
          },
          {
            title: payload?.error === 'scene_conflict' ? '新 Scene' : '另一方',
            render: (_, row) => (
              <div>
                <div>{row.incomingScene.status}</div>
                <Typography.Text type="secondary" code>
                  {row.incomingScene.preview}
                </Typography.Text>
              </div>
            ),
          },
        ]}
      />
      <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
        数据不会丢失：被关闭的 Scene 与所引用的 data 文件都还在，随时可以再激活。
      </Typography.Paragraph>
    </Modal>
  );
}
