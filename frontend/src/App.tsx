import React, { useEffect, useState } from 'react';
import { Layout, Menu, Button, Select, Typography, message } from 'antd';
import { LogoutOutlined } from '@ant-design/icons';
import { post } from './api';
import { ROLE_LABEL } from './labels';
import ResidentPages from './pages/ResidentPages';
import WorkerPages from './pages/WorkerPages';
import CounselorPages from './pages/CounselorPages';
import AdminPages from './pages/AdminPages';

interface AuthUser { id: string; username: string; realName: string; role: string; counselorProfile?: any }

const DEMO = [
  { role: 'resident', username: 'min', password: 'min123', name: '居民·王敏' },
  { role: 'social_worker', username: 'worker', password: 'worker123', name: '社工·李社工' },
  { role: 'counselor', username: 'zhang', password: 'zhang123', name: '咨询师·张静（危机资质）' },
  { role: 'counselor', username: 'chen', password: 'chen123', name: '咨询师·陈立' },
  { role: 'admin', username: 'admin', password: 'admin123', name: '管理者·王主任' },
];

function Login({ onLogin }: { onLogin: (u: AuthUser, token: string) => void }) {
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ username: 'min', password: 'min123' });
  const submit = async () => {
    if (!form.username || !form.password) return message.warning('请输入账号密码');
    setLoading(true);
    try {
      const r = await post<{ ok: boolean; token?: string; user?: AuthUser; message?: string }>('/auth/login', form);
      if (!r.ok) return message.error(r.message || '登录失败');
      onLogin(r.user!, r.token!);
    } catch (e: any) {
      message.error(e.message);
    } finally { setLoading(false); }
  };
  return (
    <div className="login-wrap">
      <div className="login-card">
        <h1>心桥 · 社区心理服务平台</h1>
        <div className="p">心理咨询预约 · 危机转介 · 服务链随访（分权管理）</div>
        <Select
          style={{ width: '100%', marginBottom: 10 }}
          defaultValue="min"
          options={DEMO.map(d => ({ value: d.username, label: d.name }))}
          onChange={v => { const d = DEMO.find(x => x.username === v)!; setForm({ username: d.username, password: d.password }); }}
        />
        <input
          className="ant-input" style={{ width: '100%', marginBottom: 10, height: 38, padding: '0 12px', borderRadius: 8, border: '1px solid #d9d9d9' }}
          placeholder="用户名" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })}
        />
        <input
          className="ant-input" type="password" style={{ width: '100%', marginBottom: 16, height: 38, padding: '0 12px', borderRadius: 8, border: '1px solid #d9d9d9' }}
          placeholder="密码" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })}
          onKeyDown={e => e.key === 'Enter' && submit()}
        />
        <Button type="primary" block size="large" loading={loading} onClick={submit}>登 录</Button>
        <div className="demo-accounts">
          演示账号（选择上方下拉自动填充）：居民 <code>min/min123</code>、<code>lin/lin123</code><br />
          社工 <code>worker/worker123</code>｜咨询师 <code>zhang/zhang123</code>、<code>chen/chen123</code><br />
          社区管理者 <code>admin/admin123</code>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(() => {
    try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch { return null; }
  });

  const onLogin = (u: AuthUser, token: string) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(u));
    setUser(u);
  };
  const logout = () => { localStorage.clear(); setUser(null); };

  if (!user) return <Login onLogin={onLogin} />;

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <div className="app-header">
        <span className="title">心桥 · 社区心理服务平台</span>
        <span className="sub">{user.realName}（{ROLE_LABEL[user.role]}）</span>
        <span className="right">
          <Button size="small" ghost icon={<LogoutOutlined />} onClick={logout}>退出</Button>
        </span>
      </div>
      <div style={{ padding: 20 }}>
        {user.role === 'resident' && <ResidentPages />}
        {user.role === 'social_worker' && <WorkerPages />}
        {user.role === 'counselor' && <CounselorPages />}
        {user.role === 'admin' && <AdminPages />}
      </div>
    </Layout>
  );
}
