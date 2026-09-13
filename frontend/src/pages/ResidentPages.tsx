import { ReactNode, useEffect, useState } from 'react';
import {
  Tabs, Card, Form, Input, InputNumber, Select, Radio, Button, Checkbox, TimePicker,
  Table, Tag, Modal, message, Alert, Descriptions, Rate, Timeline, Typography, Space, Popconfirm,
} from 'antd';
import dayjs from 'dayjs';
import { get, post } from '../api';
import {
  TOPIC_CATEGORIES, URGENCY, SELF_HARM, urgencyTag, riskTag, statusTag,
  APPT_STATUS, REQ_STATUS,
} from '../labels';
import ChainTimeline from '../ChainTimeline';

const { TextArea } = Input;

function BookingForm({ onCreated }: { onCreated: () => void }) {
  const [form] = Form.useForm();
  const [times, setTimes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [triageMsg, setTriageMsg] = useState<string | null>(null);
  const urgency = Form.useWatch('urgency', form);
  const selfHarm = Form.useWatch('selfHarmRisk', form);
  const crisis = urgency === 'high' || urgency === 'crisis' || selfHarm === 'plan' || selfHarm === 'recent_act';

  const submit = async () => {
    const v = await form.validateFields();
    setLoading(true);
    try {
      const r = await post('/resident/requests', { ...v, preferredTimes: times });
      if (r.ok) {
        if (r.triage) {
          // 命中关键词/高危：平台不进入普通排班
          setTriageMsg(r.message);
          message.warning('已进入高危即时分流通道，社工将尽快与您联系');
          form.resetFields(); setTimes([]); onCreated();
          return;
        }
        message.success('预约申请已提交');
        // 普通单立即尝试平台匹配
        try {
          const m = await post(`/resident/requests/${r.request.id}/match`);
          if (m.ok) message.success('平台已根据资质/时段/主题/危机等级生成预约');
          else message.warning(m.message);
        } catch { /* 无匹配时不阻断 */ }
        form.resetFields(); setTimes([]); onCreated();
      }
    } catch (e: any) { message.error(e.message); }
    finally { setLoading(false); }
  };

  return (
    <Card>
      {triageMsg && (
        <Alert
          type="error" showIcon closable style={{ marginBottom: 14 }}
          message="高危预约已即时分流（未进入普通排班）" description={triageMsg}
          onClose={() => setTriageMsg(null)}
        />
      )}
      {crisis && (
        <Alert
          type="error" showIcon style={{ marginBottom: 14 }}
          message="检测到较高危机等级"
          description="您的安全最重要。平台将把申请送入危机优先通道，仅安排具备危机干预资质的咨询师；社工将尽快与您联系。如您此刻有伤害自己的冲动，请立即拨打心理援助热线 400-161-9995 或 120。"
        />
      )}
      <Form form={form} layout="vertical" initialValues={{ urgency: 'low', selfHarmRisk: 'none', topicCategory: '情绪压力', age: 30 }}>
        <Form.Item label="咨询主题类别" name="topicCategory" rules={[{ required: true }]}>
          <Select options={TOPIC_CATEGORIES.map(t => ({ value: t, label: t }))} />
        </Form.Item>
        <Form.Item label="想咨询的问题（主题描述）" name="topic" rules={[{ required: true, message: '请描述您想咨询的问题' }]}>
          <TextArea rows={3} placeholder="例如：近期工作压力大，持续失眠，情绪低落……" />
        </Form.Item>
        <Space size="large" wrap>
          <Form.Item label="年龄" name="age" rules={[{ required: true }]}>
            <InputNumber min={1} max={120} />
          </Form.Item>
          <Form.Item label="紧急程度" name="urgency" rules={[{ required: true }]}>
            <Select style={{ width: 140 }} options={URGENCY.map(u => ({ value: u.value, label: u.label }))} />
          </Form.Item>
          <Form.Item label="是否有自伤/自杀风险" name="selfHarmRisk" rules={[{ required: true }]}>
            <Select style={{ width: 170 }} options={SELF_HARM.map(u => ({ value: u.value, label: u.label }))} />
          </Form.Item>
        </Space>
        <Form.Item label="既往咨询经历" name="priorCounseling">
          <TextArea rows={2} placeholder="此前是否做过心理咨询/治疗，如有请简述时间与情况（可选）" />
        </Form.Item>
        <Card size="small" style={{ marginBottom: 16, background: '#fafafa' }}
          title={<span style={{ fontSize: 13 }}>紧急联系人（高危情况下社工将优先与其联系）</span>}>
          <Space size="large" wrap>
            <Form.Item name="emergencyContactName" label="姓名" style={{ marginBottom: 8 }}><Input placeholder="如：张建国" /></Form.Item>
            <Form.Item name="emergencyContactRelation" label="关系" style={{ marginBottom: 8 }}><Input placeholder="配偶/父母/子女" /></Form.Item>
            <Form.Item name="emergencyContactPhone" label="电话" style={{ marginBottom: 8 }}><Input placeholder="手机号码" /></Form.Item>
          </Space>
        </Card>
        <Form.Item label="可约时间（可添加多个，平台将优先匹配符合的时段）">
          <TimePicker
            format="HH:mm" minuteStep={30}
            onChange={t => {
              if (!t) return;
              const label = t.format('HH:mm');
              if (!times.includes(label)) setTimes([...times, label]);
            }}
          />
          <div style={{ marginTop: 8 }}>
            {times.map(t => (
              <Tag
                key={t} closable color="blue"
                onClose={() => setTimes(times.filter(x => x !== t))}
              >{t}</Tag>
            ))}
            {!times.length && <span className="muted">未添加时，平台将安排咨询师最早空档</span>}
          </div>
        </Form.Item>
        <Form.Item name="confidentialityAuthorized" valuePropName="checked"
          rules={[{ validator: (_, v) => v ? Promise.resolve() : Promise.reject(new Error('需签署保密授权才能提交')) }]}>
          <Checkbox>
            我已阅读并同意《保密协议》：我的信息仅用于本次心理咨询服务；法律规定的危机情形（如自伤/伤人风险）下，平台可在必要范围内联系家属或转介医院
          </Checkbox>
        </Form.Item>
        <Button type="primary" size="large" loading={loading} onClick={submit}>提交预约申请</Button>
      </Form>
    </Card>
  );
}

function MyRequests({ refreshKey, onChanged }: { refreshKey: number; onChanged: () => void }) {
  const [rows, setRows] = useState<any[]>([]);
  const [cand, setCand] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const load = async () => setRows(await get('/resident/requests'));
  useEffect(() => { load(); }, [refreshKey]);

  const preview = async (id: string) => {
    setLoading(true);
    try { setCand({ id, data: await get(`/resident/requests/${id}/candidates`) }); }
    catch (e: any) { message.error(e.message); } finally { setLoading(false); }
  };
  const doMatch = async (id: string) => {
    const m = await post(`/resident/requests/${id}/match`);
    if (m.ok) { message.success('已生成预约，可在「我的服务档案」查看'); setCand(null); load(); onChanged(); }
    else message.warning(m.message);
  };

  return (
    <Card title="我的预约申请">
      <Table
        rowKey="id" loading={loading} dataSource={rows} pagination={false}
        columns={[
          { title: '主题', dataIndex: 'topicCategory', render: (v, r) => <><b>{v}</b><div className="muted" style={{ maxWidth: 320 }}>{r.topic}</div></> },
          { title: '紧急程度', dataIndex: 'urgency', render: urgencyTag },
          { title: '自伤风险', dataIndex: 'selfHarmRisk', render: riskTag },
          { title: '危机通道', dataIndex: 'crisisFlag', render: v => v ? <Tag color="red">危机优先</Tag> : <Tag>普通</Tag> },
          { title: '状态', dataIndex: 'status', render: (v: string) => statusTag(REQ_STATUS, v) },
          {
            title: '操作', render: (_, r) => (
              <Space>
                <Button size="small" disabled={r.status === 'triage'} onClick={() => preview(r.id)}>匹配预览</Button>
                {r.status === 'submitted' && (
                  <Button size="small" type="primary" onClick={() => doMatch(r.id)}>平台生成预约</Button>
                )}
                {r.status === 'triage' && <Tag color="red">社工即时分流中</Tag>}
              </Space>
            ),
          },
        ]}
      />
      <Modal
        open={!!cand} title="咨询师匹配候选（资质·主题·时段·危机等级综合评分）" width={720}
        footer={null} onCancel={() => setCand(null)}
      >
        {cand && (
          <>
            {cand.data.crisis && <Alert type="error" showIcon style={{ marginBottom: 12 }} message="本单为危机等级，仅展示具危机干预资质的咨询师" />}
            {!cand.data.candidates.length && <Alert type="warning" message="暂无可匹配咨询师/空档" />}
            {cand.data.candidates.map((c: any, i: number) => (
              <Card key={c.counselorId} size="small" style={{ marginBottom: 8 }} title={
                <Space>{i === 0 ? <Tag color="red">最佳匹配</Tag> : <Tag>第{i + 1}候选</Tag>}<b>{c.name}</b><span className="muted">{c.title}</span>
                  {c.crisisCertified && <Tag color="volcano">危机干预资质</Tag>}
                  <Tag color="green">评分 {c.score}</Tag></Space>
              }>
                <div style={{ marginBottom: 6 }}>{c.specialties.map((s: string) => <Tag key={s}>{s}</Tag>)}</div>
                <div>{c.reasons.map((x: string) => <div key={x}>· {x}</div>)}</div>
                <div style={{ marginTop: 6 }}>建议时段：{c.slot ? <b>{c.slot.label}</b> : <span className="muted">暂无空档</span>}</div>
                {i === 0 && c.slot && (
                  <Button type="primary" size="small" style={{ marginTop: 8 }} onClick={() => doMatch(cand.id)}>
                    按最佳匹配生成预约
                  </Button>
                )}
              </Card>
            ))}
          </>
        )}
      </Modal>
    </Card>
  );
}

function Archive({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<{ appointments: any[] }>({ appointments: [] });
  const [detail, setDetail] = useState<any>(null);
  const [rateFor, setRateFor] = useState<string | null>(null);
  const [familyFor, setFamilyFor] = useState<string | null>(null);
  const [form] = Form.useForm();
  const [famForm] = Form.useForm();

  const load = async () => setData(await get('/resident/archive'));
  useEffect(() => { load(); }, [refreshKey]);

  const submitRating = async () => {
    const v = await form.validateFields();
    await post(`/resident/appointments/${rateFor}/rating`, v);
    message.success('感谢您的评价'); setRateFor(null); form.resetFields(); load();
  };
  const submitFamily = async () => {
    const v = await famForm.validateFields();
    await post(`/resident/appointments/${familyFor}/family-access`, v);
    message.success('家属查看申请已提交，等待社区管理者审批'); setFamilyFor(null); famForm.resetFields();
  };

  return (
    <Card title="我的服务档案（预约→初筛→咨询→随访 全链条）">
      <Table
        rowKey="appointment.id" dataSource={data.appointments} pagination={false}
        columns={[
          { title: '预约时间', render: (_, r) => dayjs(r.appointment.scheduledAt).format('YYYY-MM-DD HH:mm') },
          { title: '咨询师', dataIndex: ['appointment', 'counselorName'] },
          { title: '风险等级', render: (_, r) => urgencyTag(r.appointment.crisisLevel) },
          { title: '状态', render: (_, r) => statusTag(APPT_STATUS, r.appointment.status) },
          {
            title: '操作', render: (_, r) => (
              <Space wrap>
                <Button size="small" onClick={() => setDetail(r)}>服务链时间线</Button>
                {r.appointment.status === 'completed' && (
                  <Button size="small" type="primary" disabled={r.rated} onClick={() => setRateFor(r.appointment.id)}>
                    {r.rated ? '已评价' : '服务评价'}
                  </Button>
                )}
                <Button size="small" onClick={() => setFamilyFor(r.appointment.id)}>申请家属查看记录</Button>
              </Space>
            ),
          },
        ]}
      />

      <Modal open={!!detail} title="服务链时间线与我的记录" footer={null} width={720} onCancel={() => setDetail(null)}>
        {detail && (
          <>
            <Descriptions size="small" column={2} bordered style={{ marginBottom: 12 }}>
              <Descriptions.Item label="状态">{statusTag(APPT_STATUS, detail.appointment.status)}</Descriptions.Item>
              <Descriptions.Item label="风险等级">{urgencyTag(detail.appointment.crisisLevel)}</Descriptions.Item>
              <Descriptions.Item label="地点">{detail.appointment.location}</Descriptions.Item>
              <Descriptions.Item label="备注">{detail.appointment.statusReason || '—'}</Descriptions.Item>
            </Descriptions>
            <Typography.Title level={5}>我的咨询记录（按权限仅显示主题与下次计划）</Typography.Title>
            {detail.records.length ? detail.records.map((rec: any) => (
              <Card key={rec.id} size="small" style={{ marginBottom: 8 }}>
                <Descriptions size="small" column={1}>
                  <Descriptions.Item label="主题">{rec.topic}</Descriptions.Item>
                  <Descriptions.Item label="下次计划">{rec.nextPlan || '—'}</Descriptions.Item>
                </Descriptions>
              </Card>
            )) : <div className="muted">暂无咨询记录</div>}
            <Typography.Title level={5} style={{ marginTop: 12 }}>服务链时间线</Typography.Title>
            <ChainTimeline events={detail.timeline} />
          </>
        )}
      </Modal>

      <Modal open={!!rateFor} title="服务评价" onOk={submitRating} onCancel={() => setRateFor(null)}>
        <Form form={form} layout="vertical">
          <Form.Item name="score" label="评分" rules={[{ required: true, message: '请评分' }]}>
            <Rate />
          </Form.Item>
          <Form.Item name="comment" label="评价内容"><TextArea rows={3} /></Form.Item>
        </Form>
      </Modal>

      <Modal open={!!familyFor} title="家属申请查看咨询记录" onOk={submitFamily} onCancel={() => setFamilyFor(null)}>
        <Alert type="info" showIcon style={{ marginBottom: 12 }}
          message="依据保密原则，咨询记录默认不向第三方开放。申请须经社区管理者审批，批准后仅限72小时内查看风险摘要（不含咨询过程原文）。" />
        <Form form={famForm} layout="vertical">
          <Form.Item name="applicantName" label="家属姓名" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="relation" label="与本人关系" rules={[{ required: true }]}><Input placeholder="配偶/父母/子女…" /></Form.Item>
          <Form.Item name="contact" label="联系方式"><Input /></Form.Item>
          <Form.Item name="reason" label="申请理由" rules={[{ required: true }]}><TextArea rows={3} /></Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}

export default function ResidentPages() {
  const [k, setK] = useState(0);
  return (
    <Tabs
      defaultActiveKey="book"
      items={[
        { key: 'book', label: '预约咨询', children: <BookingForm onCreated={() => setK(k + 1)} /> },
        { key: 'requests', label: '我的申请', children: <MyRequests refreshKey={k} onChanged={() => setK(k + 1)} /> },
        { key: 'archive', label: '我的服务档案', children: <Archive refreshKey={k} /> },
      ]}
    />
  );
}
