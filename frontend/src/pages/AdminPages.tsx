import { useEffect, useState } from 'react';
import {
  Tabs, Card, Table, Tag, Button, Space, Modal, Form, Select, Input, message,
  Row, Col, Statistic, Alert, Progress, Empty, Descriptions, Badge,
} from 'antd';
import dayjs from 'dayjs';
import { get, post } from '../api';
import { CRISIS_STATUS, REFERRAL_RESULT, REQ_STATUS, statusTag } from '../labels';
import { fmtTime, fmtMin, fmtDateTime } from '../time';

const { TextArea } = Input;

const RISK_LABEL: Record<string, string> = { crisis: '危机', high: '紧急', medium: '较急', low: '普通' };
const RISK_COLOR: Record<string, string> = { crisis: '#cf1322', high: '#fa8c16', medium: '#fadb14', low: '#a0d911' };

function Bars({ data, color = '#2f6b5e', labels }: { data: { label: string; value: number }[]; color?: string; labels?: Record<string, string> }) {
  const max = Math.max(1, ...data.map(d => d.value));
  if (!data.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" />;
  return (
    <div>
      {data.map(d => (
        <div key={d.label} style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
          <div style={{ width: 90, fontSize: 13 }}>{labels?.[d.label] || d.label}</div>
          <div style={{ flex: 1, background: '#f0f2f1', borderRadius: 6, height: 20, position: 'relative' }}>
            <div style={{ width: `${(d.value / max) * 100}%`, background: color, height: '100%', borderRadius: 6, minWidth: 2 }} />
          </div>
          <div style={{ width: 40, textAlign: 'right', fontWeight: 600 }}>{d.value}</div>
        </div>
      ))}
    </div>
  );
}

function Dashboard() {
  const [s, setS] = useState<any>(null);
  const load = async () => setS(await get('/admin/stats'));
  useEffect(() => { load(); }, []);
  if (!s) return <Card loading />;

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      <Row gutter={16}>
        <Col span={4}><Card><Statistic title="预约申请总数" value={s.volume.totalRequests} /></Card></Col>
        <Col span={4}><Card><Statistic title="生成预约" value={s.volume.totalAppts} /></Card></Col>
        <Col span={4}><Card><Statistic title="已完成咨询" value={s.volume.completed} valueStyle={{ color: '#3f8600' }} /></Card></Col>
        <Col span={4}><Card><Statistic title="爽约" value={s.volume.noShow} /></Card></Col>
        <Col span={4}><Card><Statistic title="已转介" value={s.volume.referred} valueStyle={{ color: '#722ed1' }} /></Card></Col>
        <Col span={4}><Card><Statistic title="平均评价" value={s.volume.avgRating ?? '—'} suffix={s.volume.avgRating ? '/5' : ''} /></Card></Col>
      </Row>

      {s.triage && (
        <Card title="高危预约即时分流" style={{ marginTop: 16 }}>
          <Row gutter={16}>
            <Col span={5}><Statistic title="触发分流总数" value={s.triage.total} /></Col>
            <Col span={5}><Statistic title="社工处置中" value={s.triage.pending} valueStyle={{ color: '#cf1322' }} /></Col>
            <Col span={5}><Statistic title="已转介医院" value={s.triage.referred} valueStyle={{ color: '#722ed1' }} /></Col>
            <Col span={5}><Statistic title="转入社区咨询" value={s.triage.admittedCommunity} valueStyle={{ color: '#1677ff' }} /></Col>
            <Col span={4}><Statistic title="回执闭环" value={s.triage.closed} valueStyle={{ color: '#3f8600' }} /></Col>
          </Row>
        </Card>
      )}

      <Card title="供给决策建议（由服务量·风险等级·转介结果自动生成）" extra={<Button size="small" onClick={load}>刷新</Button>}>
        <Space direction="vertical" style={{ width: '100%' }}>
          {s.recommendations.map((r: any, i: number) => (
            <Alert
              key={i} showIcon
              type={r.level === 'critical' ? 'error' : r.level === 'warning' ? 'warning' : 'success'}
              message={
                <Space>
                  <Tag>{r.type === 'capacity' ? '增加咨询师' : r.type === 'training' ? '社工培训' : r.type === 'hospital' ? '医院合作' : r.type === 'followup' ? '随访提醒' : '运行正常'}</Tag>
                  {r.text}
                </Space>
              }
            />
          ))}
        </Space>
      </Card>

      <Row gutter={16}>
        <Col span={8}>
          <Card title="近6个月咨询服务量" style={{ height: '100%' }}>
            <Bars data={[...s.monthly].reverse().map((m: any) => ({ label: m.month, value: m.count }))} />
          </Card>
        </Col>
        <Col span={8}>
          <Card title="预约风险等级分布" style={{ height: '100%' }}>
            <Bars
              data={['crisis', 'high', 'medium', 'low'].map(k => ({ label: k, value: s.riskDistribution[k] }))}
              labels={RISK_LABEL} color="#c05a4b"
            />
            <div style={{ marginTop: 10 }}>
              <Tag color="red">危机申请 {s.crisis.crisisRequests}</Tag>
              <Tag color="orange">危机事件待处置 {s.crisis.open}</Tag>
              <Tag color="green">已解除 {s.crisis.resolved}</Tag>
            </div>
          </Card>
        </Col>
        <Col span={8}>
          <Card title="转介结果分布（结果回流影响供给）" style={{ height: '100%' }}>
            <Bars
              data={s.referralResults.map((r: any) => ({ label: r.result, value: r.count }))}
              labels={Object.fromEntries(Object.entries(REFERRAL_RESULT).map(([k, v]) => [k, v.label]))}
              color="#722ed1"
            />
            <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              初筛决定：{s.screeningDecisions.map((d: any) =>
                `${d.decision === 'suitable' ? '适合社区' : d.decision === 'family_involved' ? '家属参与' : '直接转介'} ${d.count}`).join('｜')}
            </div>
          </Card>
        </Col>
      </Row>

      <Card title="咨询师负载与危机承接">
        <Table
          rowKey="counselorId" dataSource={s.counselorLoad} pagination={false}
          columns={[
            { title: '咨询师', dataIndex: 'name' },
            { title: '在管案例', dataIndex: 'cases' },
            { title: '危机/高风险案例', dataIndex: 'crisisCases', render: (v: number) => <Tag color={v ? 'red' : 'default'}>{v}</Tag> },
            { title: '负载率', render: (_, r) => <Progress percent={Math.min(100, Math.round(r.cases / 12 * 100))} size="small" status={r.cases > 12 ? 'exception' : 'active'} /> },
          ]}
        />
        <Descriptions size="small" column={3} style={{ marginTop: 10 }}>
          <Descriptions.Item label="在岗咨询师">{s.supply.totalCounselors}</Descriptions.Item>
          <Descriptions.Item label="具危机干预资质">{s.supply.certifiedCounselors}</Descriptions.Item>
          <Descriptions.Item label="在岗社工">{s.supply.totalWorkers}</Descriptions.Item>
        </Descriptions>
      </Card>
    </Space>
  );
}

function Approvals() {
  const [leaves, setLeaves] = useState<any[]>([]);
  const [families, setFamilies] = useState<any[]>([]);
  const load = async () => {
    setLeaves(await get('/admin/leave-requests'));
    setFamilies(await get('/admin/family-requests?status=pending'));
  };
  useEffect(() => { load(); }, []);

  const reviewLeave = async (r: any, approve: boolean) => {
    const res = await post(`/admin/leave-requests/${r.id}/review`, { approve });
    if (approve) {
      message.success(`已批准：自动改约 ${res.rescheduled} 例，挂起待排班 ${res.stranded} 例`);
    } else message.success('已驳回');
    load();
  };
  const reviewFamily = async (r: any, approve: boolean) => {
    let note = '';
    if (!approve) {
      Modal.confirm({
        title: '驳回理由', content: <Input id="fam-note" placeholder="依据保密原则…" />,
        onOk: async () => {
          note = (document.getElementById('fam-note') as HTMLInputElement)?.value || '依据保密原则';
          await post(`/admin/family-requests/${r.id}/review`, { approve: false, note });
          message.success('已驳回并记录服务链'); load();
        },
      });
      return;
    }
    await post(`/admin/family-requests/${r.id}/review`, { approve: true });
    message.success('已批准：72小时内可查看脱敏风险摘要（一次性授权）');
    load();
  };

  const viewRecord = async (r: any) => {
    try {
      const recs = await get(`/admin/family-requests/${r.id}/record`);
      Modal.info({
        title: `批准单 ${r.applicantName} 可见的脱敏摘要（72h有效，至 ${fmtMin(r.expiresAt)}）`,
        width: 640,
        content: (
          <div>
            {recs.map((x: any) => (
              <Card key={x.id} size="small" style={{ marginBottom: 8 }}>
                <div><b>{x.topic}</b>（风险：{RISK_LABEL[x.riskLevel]}）</div>
                <div>风险评估：{x.riskAssessment || '—'}</div>
                <div>干预建议：{x.interventionAdvice}</div>
                <div className="muted">注：咨询过程原文依法不予展示</div>
              </Card>
            ))}
          </div>
        ),
      });
    } catch (e: any) { message.error(e.message); }
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      <Card title={<Space><Badge count={leaves.filter(l => l.status === 'pending').length} showZero={false} />咨询师请假审批</Space>}>
        <Table
          rowKey="id" dataSource={leaves} pagination={false}
          columns={[
            { title: '起止', render: (_, r) => `${r.startDate} ~ ${r.endDate}` },
            { title: '事由', dataIndex: 'reason' },
            { title: '状态', dataIndex: 'status', render: (v: string) =>
              v === 'pending' ? <Tag color="gold">待审批</Tag> : v === 'approved' ? <Tag color="green">已批准</Tag> : <Tag color="red">已驳回</Tag> },
            {
              title: '操作', render: (_, r) => r.status === 'pending' && (
                <Space>
                  <Button size="small" type="primary" onClick={() => reviewLeave(r, true)}>批准并自动改约</Button>
                  <Button size="small" danger onClick={() => reviewLeave(r, false)}>驳回</Button>
                </Space>
              ),
            },
          ]}
        />
      </Card>
      <Card title={<Space><Badge count={families.length} showZero={false} />家属查看咨询记录审批（保密例外）</Space>}>
        <Table
          rowKey="id" dataSource={families} pagination={false}
          columns={[
            { title: '申请人', render: (_, r) => `${r.applicantName}（${r.relation}）` },
            { title: '联系方式', dataIndex: 'contact' },
            { title: '理由', dataIndex: 'reason' },
            { title: '申请时间', render: (_, r) => fmtMin(r.createdAt) },
            {
              title: '操作', render: (_, r) => (
                <Space>
                  <Button size="small" type="primary" onClick={() => reviewFamily(r, true)}>批准（72h脱敏）</Button>
                  <Button size="small" danger onClick={() => reviewFamily(r, false)}>驳回</Button>
                </Space>
              ),
            },
          ]}
        />
        <div className="muted" style={{ marginTop: 8 }}>
          已批准的历史申请可在「全部申请」中查看摘要：
        </div>
        <ApprovedFamilyList onView={viewRecord} />
      </Card>
    </Space>
  );
}

function ApprovedFamilyList({ onView }: { onView: (r: any) => void }) {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => { get('/admin/family-requests?status=approved').then(setRows); }, []);
  if (!rows.length) return null;
  return (
    <Table
      style={{ marginTop: 8 }} rowKey="id" dataSource={rows} pagination={false} size="small"
      columns={[
        { title: '家属', render: (_, r) => `${r.applicantName}（${r.relation}）` },
        {
          title: '授权状态', render: (_, r) => r.viewedAt
            ? <Tag color="red">一次性授权已使用（{fmtMin(r.viewedAt)}）</Tag>
            : <Tag color="green">未使用，可查看一次</Tag>,
        },
        { title: '有效期至', render: (_, r) => r.expiresAt ? fmtMin(r.expiresAt) : '—' },
        {
          title: '操作', render: (_, r) => r.viewedAt
            ? <Button size="small" disabled title="一次性授权已使用，再次查看将被拒绝并留痕">已查看</Button>
            : <Button size="small" type="primary" onClick={() => onView(r)}>查看脱敏摘要（仅此一次）</Button>,
        },
      ]}
    />
  );
}

function Referrals() {
  const [rows, setRows] = useState<any[]>([]);
  const [target, setTarget] = useState<any>(null);
  const [form] = Form.useForm();
  const load = async () => setRows(await get('/admin/referrals'));
  useEffect(() => { load(); }, []);

  const submit = async () => {
    const v = await form.validateFields();
    await post(`/admin/referrals/${target.id}/receipt`, v);
    message.success('转介回执已登记，结果回流至供给看板');
    setTarget(null); form.resetFields(); load();
  };

  return (
    <Card title="转介单与医院回执（转介结果影响社区服务供给评估）">
      <Table
        rowKey="id" dataSource={rows} pagination={false}
        columns={[
          { title: '转出时间', render: (_, r) => fmtTime(r.createdAt).slice(5,10) },
          { title: '目标', render: (_, r) => `${r.targetOrg}·${r.department}` },
          { title: '原因', dataIndex: 'reason', render: (v: string) => <span style={{ maxWidth: 260 }}>{v}</span> },
          {
            title: '状态/结果', render: (_, r) => {
              const o = REFERRAL_RESULT[r.outcome || r.status];
              return <Tag color={o?.color}>{o?.label || r.status}</Tag>;
            },
          },
          { title: '回执', dataIndex: 'receiptText', render: (v: string) => v || <span className="muted">未回执</span> },
          {
            title: '操作', render: (_, r) => r.status !== 'receipt_received' &&
              <Button size="small" type="primary" onClick={() => setTarget(r)}>登记回执</Button>,
          },
        ]}
      />
      <Modal open={!!target} title="登记医院转介回执" onOk={submit} onCancel={() => setTarget(null)}>
        <Form form={form} layout="vertical" initialValues={{ outcome: 'accepted' }}>
          <Form.Item name="outcome" label="转介结果" rules={[{ required: true }]}>
            <Select options={[
              { value: 'accepted', label: '医院接诊' },
              { value: 'outpatient', label: '门诊治疗' },
              { value: 'hospitalized', label: '收治住院' },
              { value: 'declined', label: '退回/拒收（触发复盘）' },
            ]} />
          </Form.Item>
          <Form.Item name="receiptText" label="回执内容" rules={[{ required: true }]}>
            <TextArea rows={4} placeholder="诊断/处置意见/社区接续建议…" />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}

function CrisisOverview() {
  const [d, setD] = useState<any>(null);
  useEffect(() => { get('/admin/crisis').then(setD); }, []);
  if (!d) return <Card loading />;
  return (
    <Card title="危机事件总览（危机事件与普通咨询严格分离）">
      <Row gutter={16} style={{ marginBottom: 12 }}>
        <Col span={6}><Card><Statistic title="待处置" value={d.open} valueStyle={{ color: '#cf1322' }} /></Card></Col>
        <Col span={6}><Card><Statistic title="已解除" value={d.resolved} valueStyle={{ color: '#3f8600' }} /></Card></Col>
      </Row>
      <Table
        rowKey="id" dataSource={d.list} pagination={false}
        columns={[
          { title: '时间', render: (_, r) => fmtDateTime(r.createdAt) },
          { title: '级别', dataIndex: 'level', render: (v: string) => <Tag color="red">{v}</Tag> },
          { title: '描述', dataIndex: 'description' },
          { title: '处置', dataIndex: 'actionTaken' },
          { title: '已送医', dataIndex: 'escalatedToHospital', render: (v: boolean) => v ? <Tag color="purple">是</Tag> : '—' },
          { title: '状态', dataIndex: 'status', render: (v: string) => statusTag(CRISIS_STATUS, v) },
        ]}
      />
    </Card>
  );
}

function Oversight() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => { get('/resident/requests?scope=all').then(setRows); }, []);
  return (
    <Card title="全社区预约申请监管（危机标识优先）">
      <Table
        rowKey="id" dataSource={rows} pagination={{ pageSize: 10 }}
        columns={[
          { title: '居民', dataIndex: 'residentName' },
          { title: '主题', render: (_, r) => <><Tag>{r.topicCategory}</Tag>{r.topic?.slice(0, 20)}…</> },
          { title: '紧急', dataIndex: 'urgency', render: (v: string) => <Tag color={v === 'crisis' ? 'red' : v === 'high' ? 'orange' : 'default'}>{v}</Tag> },
          { title: '自伤风险', dataIndex: 'selfHarmRisk', render: (v: string) => <Tag color={['plan', 'recent_act'].includes(v) ? 'red' : 'default'}>{v}</Tag> },
          { title: '危机通道', dataIndex: 'crisisFlag', render: (v: boolean) => v ? <Tag color="red">危机优先</Tag> : <Tag>普通</Tag> },
          { title: '保密授权', dataIndex: 'confidentialityAuthorized', render: (v: boolean) => v ? <Tag color="green">已授权</Tag> : <Tag color="red">未授权</Tag> },
          { title: '状态', dataIndex: 'status', render: (v: string) => statusTag(REQ_STATUS, v) },
        ]}
      />
    </Card>
  );
}

export default function AdminPages() {
  return (
    <>
      <h2 className="page-title">社区管理看板</h2>
      <div className="page-desc">汇总咨询服务量、风险等级与转介结果，评估是否增加咨询师、社工培训或深化医院合作</div>
      <Tabs
        items={[
          { key: 'dash', label: '供给与风险看板', children: <Dashboard /> },
          { key: 'approval', label: '审批中心（请假/家属记录）', children: <Approvals /> },
          { key: 'referral', label: '转介与回执', children: <Referrals /> },
          { key: 'crisis', label: '危机事件总览', children: <CrisisOverview /> },
          { key: 'oversight', label: '申请监管', children: <Oversight /> },
        ]}
      />
    </>
  );
}
