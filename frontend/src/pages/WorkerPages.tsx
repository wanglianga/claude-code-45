import { useEffect, useState } from 'react';
import {
  Tabs, Card, Table, Tag, Button, Space, Modal, Form, Select, Radio, Input, Switch, message,
  Descriptions, Alert, Badge, Statistic, Row, Col, Timeline, Checkbox,
} from 'antd';
import dayjs from 'dayjs';
import { get, post } from '../api';
import {
  urgencyTag, statusTag, APPT_STATUS, URGENCY, SELF_HARM, CRISIS_STATUS, REFERRAL_RESULT,
  TRIAGE_STATUS,
} from '../labels';
import ChainTimeline from '../ChainTimeline';
import { fmtTime, fmtMin, fmtDateTime } from '../time';

const { TextArea } = Input;

// 预约列表 + 初筛/爽约
function Appointments() {
  const [rows, setRows] = useState<any[]>([]);
  const [crisisOnly, setCrisisOnly] = useState(false);
  const [detail, setDetail] = useState<any>(null);
  const [screenOpen, setScreenOpen] = useState(false);
  const [followOpen, setFollowOpen] = useState(false);
  const [form] = Form.useForm();
  const [fuForm] = Form.useForm();
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const data = await get(`/worker/appointments${crisisOnly ? '?crisis=1' : ''}`);
    setRows(data);
  };
  useEffect(() => { load(); }, [crisisOnly]);

  const openDetail = async (id: string) => setDetail(await get(`/worker/appointments/${id}`));

  const submitScreen = async () => {
    const v = await form.validateFields();
    setBusy(true);
    try {
      const r = await post(`/worker/appointments/${detail.appointment.id}/screening`, {
        ...v,
        suitableCommunity: v.decision !== 'refer_hospital',
        familyInvolved: v.decision === 'family_involved',
        familyMembers: (v.familyMembers || '').split(/[,，、]/).map((x: string) => x.trim()).filter(Boolean),
      });
      if (r.ok) {
        message.success(r.status === 'referred' ? '初筛完成：已直接转介精神专科' : '初筛完成，预约已确认');
        setScreenOpen(false); form.resetFields(); setDetail(null); load();
      }
    } catch (e: any) { message.error(e.message); } finally { setBusy(false); }
  };

  const submitFollow = async () => {
    const v = await fuForm.validateFields();
    await post(`/worker/appointments/${detail.appointment.id}/followup`, v);
    message.success('随访已记录'); setFollowOpen(false); fuForm.resetFields(); setDetail(null); load();
  };

  const noShow = async (id: string) => {
    await post(`/worker/appointments/${id}/no-show`);
    message.success('已登记爽约，时段释放，建议尽快电话随访');
    setDetail(null); load();
  };

  return (
    <Card
      title="咨询前初筛与预约管理"
      extra={<Space><Switch checked={crisisOnly} onChange={setCrisisOnly} /><span>仅看危机/高风险</span></Space>}
    >
      <Table
        rowKey="id" dataSource={rows} pagination={{ pageSize: 8 }}
        columns={[
          { title: '预约时间', render: (_, r) => fmtMin(r.scheduledAt) },
          { title: '居民', dataIndex: 'residentName' },
          { title: '咨询师', dataIndex: 'counselorName' },
          { title: '主题', render: (_, r) => <><Tag>{r.topicCategory}</Tag><span className="muted">{r.topic?.slice(0, 18)}…</span></> },
          { title: '风险', dataIndex: 'crisisLevel', render: urgencyTag },
          { title: '自伤', dataIndex: 'selfHarmRisk', render: (v: string) => {
            const o = SELF_HARM.find(x => x.value === v); return <Tag color={o?.color}>{o?.label || v}</Tag>; } },
          { title: '状态', dataIndex: 'status', render: (v: string) => statusTag(APPT_STATUS, v) },
          {
            title: '操作', width: 220, render: (_, r) => (
              <Space wrap>
                <Button size="small" onClick={() => openDetail(r.id)}>详情/服务链</Button>
                {r.status === 'pending' && <Button size="small" type="primary" onClick={async () => { await openDetail(r.id); setScreenOpen(true); }}>初筛</Button>}
                {['confirmed', 'in_progress'].includes(r.status) && <Button size="small" danger onClick={() => noShow(r.id)}>爽约登记</Button>}
              </Space>
            ),
          },
        ]}
      />

      <Modal open={!!detail && !screenOpen && !followOpen} title="预约详情与服务链" width={780} footer={null} onCancel={() => setDetail(null)}>
        {detail && (
          <>
            {['high', 'crisis'].includes(detail.appointment.crisisLevel) &&
              <Alert type="error" showIcon style={{ marginBottom: 12 }} message="本单为高风险/危机个案，处置与普通咨询分流管理" />}
            <Descriptions size="small" bordered column={2}>
              <Descriptions.Item label="居民">{detail.resident.realName}（{detail.resident.phone}）</Descriptions.Item>
              <Descriptions.Item label="咨询师">{detail.counselor.realName}</Descriptions.Item>
              <Descriptions.Item label="主题">{detail.request?.topicCategory}</Descriptions.Item>
              <Descriptions.Item label="既往咨询">{detail.request?.priorCounseling || '无'}</Descriptions.Item>
              <Descriptions.Item label="状态">{statusTag(APPT_STATUS, detail.appointment.status)}</Descriptions.Item>
              <Descriptions.Item label="风险等级">{urgencyTag(detail.appointment.crisisLevel)}</Descriptions.Item>
              <Descriptions.Item label="问题描述" span={2}>{detail.request?.topic}</Descriptions.Item>
            </Descriptions>

            {detail.triage && (
              <Alert
                style={{ marginTop: 10 }} type="error" showIcon
                message={<Space>高危即时分流画像 {urgencyTag(detail.triage.riskLevel)}</Space>}
                description={
                  <div style={{ marginTop: 6 }}>
                    <div>来访原因：{detail.triage.visitReason}</div>
                    {detail.triage.scaleResult && <div>量表：{detail.triage.scaleResult}{detail.triage.scaleScore != null ? `（${detail.triage.scaleScore}分）` : ''}</div>}
                    <div>紧急联系人：{detail.triage.emergencyContactName}（{detail.triage.emergencyContactRelation}）{detail.triage.emergencyContactPhone}</div>
                    {detail.triage.emergencyContactResponse && <div>联系人响应：{detail.triage.emergencyContactResponse}</div>}
                    <div className="muted">响应社工：{detail.triage.socialWorkerName}｜{detail.triage.respondedAt ? fmtMin(detail.triage.respondedAt) : '未响应'}</div>
                  </div>
                }
              />
            )}

            {detail.screening && (
              <Card size="small" style={{ marginTop: 10 }} title="初筛结论">
                <Descriptions size="small" column={1}>
                  <Descriptions.Item label="处置决定">
                    {detail.screening.decision === 'suitable' ? '适合社区咨询' :
                      detail.screening.decision === 'family_involved' ? '适合社区咨询，需家属参与' : '直接转介医院'}
                  </Descriptions.Item>
                  <Descriptions.Item label="风险评估">{detail.screening.riskAssessment || '—'}</Descriptions.Item>
                  <Descriptions.Item label="建议">{detail.screening.recommendation || '—'}</Descriptions.Item>
                </Descriptions>
              </Card>
            )}

            {detail.referrals?.length > 0 && detail.referrals.map((rf: any) => (
              <Card size="small" key={rf.id} style={{ marginTop: 8 }} title={<Space>转介单 <Tag color="purple">{rf.targetOrg}·{rf.department}</Tag>{REFERRAL_RESULT[rf.outcome || rf.status] && <Tag color={REFERRAL_RESULT[rf.outcome || rf.status].color}>{REFERRAL_RESULT[rf.outcome || rf.status].label}</Tag>}</Space>}>
                <div>{rf.reason}</div>
                {rf.receiptText && <Alert style={{ marginTop: 6 }} type="success" message={`医院回执：${rf.receiptText}`} />}
              </Card>
            ))}

            {detail.followups?.length > 0 && (
              <Card size="small" style={{ marginTop: 8 }} title="随访记录">
                {detail.followups.map((f: any) => (
                  <div key={f.id}>· {fmtMin(f.createdAt)}（{f.method === 'phone' ? '电话' : f.method === 'visit' ? '上门' : '线上'}，风险{URGENCY.find(u => u.value === f.riskLevel)?.label}）：{f.content}</div>
                ))}
              </Card>
            )}

            <Card size="small" style={{ marginTop: 8 }} title="服务链时间线">
              <ChainTimeline events={detail.timeline} />
            </Card>

            <Space style={{ marginTop: 10 }}>
              {detail.appointment.status === 'pending' && <Button type="primary" onClick={() => setScreenOpen(true)}>填写初筛</Button>}
              <Button onClick={() => setFollowOpen(true)}>新增随访</Button>
              {['confirmed', 'in_progress'].includes(detail.appointment.status) &&
                <Button danger onClick={() => noShow(detail.appointment.id)}>登记爽约</Button>}
            </Space>
          </>
        )}
      </Modal>

      <Modal open={screenOpen} title="咨询前初筛" width={640} onOk={submitScreen} confirmLoading={busy} onCancel={() => setScreenOpen(false)}>
        <Alert type="info" showIcon style={{ marginBottom: 12 }}
          message="初筛目标：确认是否适合社区咨询、是否需要家属参与、或是否直接转介医院" />
        <Form form={form} layout="vertical" initialValues={{ decision: 'suitable', crisisLevel: 'low', selfHarmConfirmed: false }}>
          <Form.Item name="decision" label="初筛处置决定" rules={[{ required: true }]}>
            <Radio.Group>
              <Space direction="vertical">
                <Radio value="suitable">适合社区咨询</Radio>
                <Radio value="family_involved">适合，但需家属参与</Radio>
                <Radio value="refer_hospital">不适合社区咨询，直接转介精神专科医院</Radio>
              </Space>
            </Radio.Group>
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="crisisLevel" label="初筛风险等级" rules={[{ required: true }]}>
                <Select options={URGENCY.map(u => ({ value: u.value, label: u.label }))} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="selfHarmConfirmed" label="是否确认自伤风险" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="familyMembers" label="建议参与家属（逗号分隔）">
            <Input placeholder="配偶,父亲" />
          </Form.Item>
          <Form.Item name="riskAssessment" label="风险评估" rules={[{ required: true, message: '请填写风险评估' }]}>
            <TextArea rows={3} placeholder="情绪状态、社会支持、自伤/伤人风险、物质使用等" />
          </Form.Item>
          <Form.Item name="recommendation" label="处置建议"><TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>

      <Modal open={followOpen} title="新增随访" onOk={submitFollow} onCancel={() => setFollowOpen(false)}>
        <Form form={fuForm} layout="vertical" initialValues={{ method: 'phone', riskLevel: 'low' }}>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="method" label="随访方式"><Select options={[
                { value: 'phone', label: '电话' }, { value: 'visit', label: '上门' }, { value: 'online', label: '线上' },
              ]} /></Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="riskLevel" label="当前风险等级"><Select options={URGENCY.map(u => ({ value: u.value, label: u.label }))} /></Form.Item>
            </Col>
          </Row>
          <Form.Item name="content" label="随访内容" rules={[{ required: true }]}><TextArea rows={3} /></Form.Item>
          <Form.Item name="nextFollowUpAt" label="计划下次随访时间">
            <Input type="datetime-local" />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}

// 危机处置台
function CrisisBoard() {
  const [list, setList] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [appts, setAppts] = useState<any[]>([]);
  const [form] = Form.useForm();

  const load = async () => setList(await get('/worker/crisis'));
  useEffect(() => { load(); get('/worker/appointments').then(setAppts); }, []);
  const openCount = list.filter(c => c.status !== 'resolved').length;

  const submit = async () => {
    const v = await form.validateFields();
    await post('/worker/crisis', v);
    message.success('危机事件已登记并进入危机处置流程（与普通咨询分流）');
    setOpen(false); form.resetFields(); load();
  };
  const processOne = async (c: any) => {
    Modal.confirm({
      title: '记录处置动作', content: <TextArea id="crisis-action" rows={3} placeholder="如：已联系家属、陪同就医、通知民警/120…" />,
      onOk: async () => {
        const el = document.getElementById('crisis-action') as HTMLTextAreaElement;
        await post(`/worker/crisis/${c.id}/process`, { actionTaken: el?.value });
        message.success('已更新处置进展'); load();
      },
    });
  };
  const resolve = async (c: any) => {
    Modal.confirm({
      title: '危机事件结案', content: '确认风险已解除并结案？',
      onOk: async () => { await post(`/worker/crisis/${c.id}/resolve`, { note: '风险解除，转入常规随访' }); message.success('已结案'); load(); },
    });
  };

  return (
    <Card
      title={<Space><Badge count={openCount} showZero={false} color="red" />危机处置台（与普通咨询严格分流）</Space>}
      extra={<Button type="primary" danger onClick={() => setOpen(true)}>登记危机事件</Button>}
    >
      <Table
        rowKey="id" dataSource={list} pagination={false}
        columns={[
          { title: '时间', render: (_, r) => fmtMin(r.createdAt) },
          { title: '风险级别', dataIndex: 'level', render: (v: string) => {
            const o = SELF_HARM.find(x => x.value === v); return <Tag color={o?.color}>{o?.label || v}</Tag>; } },
          { title: '情况', dataIndex: 'description', render: (v: string) => <span style={{ maxWidth: 320 }}>{v}</span> },
          { title: '已送医', dataIndex: 'escalatedToHospital', render: (v: boolean) => v ? <Tag color="purple">是</Tag> : '—' },
          { title: '状态', dataIndex: 'status', render: (v: string) => statusTag(CRISIS_STATUS, v) },
          {
            title: '操作', render: (_, r) => (
              <Space>
                {r.status === 'open' && <Button size="small" type="primary" danger onClick={() => processOne(r)}>开始处置</Button>}
                {r.status === 'processing' && <Button size="small" onClick={() => resolve(r)}>解除/结案</Button>}
              </Space>
            ),
          },
        ]}
      />
      <Modal open={open} title="登记危机事件" onOk={submit} onCancel={() => setOpen(false)}>
        <Form form={form} layout="vertical" initialValues={{ level: 'ideation', escalate: false }}>
          <Form.Item name="appointmentId" label="关联预约（可空）">
            <Select allowClear options={appts
              .filter((a: any) => ['pending', 'confirmed', 'in_progress', 'no_show'].includes(a.status))
              .map((a: any) => ({ value: a.id, label: `${fmtMin(a.scheduledAt)} ${a.residentName}｜${a.topicCategory}` }))} />
          </Form.Item>
          <Form.Item name="residentName" label="居民姓名（未关联预约时填写）"><Input /></Form.Item>
          <Form.Item name="level" label="风险级别" rules={[{ required: true }]}>
            <Select options={SELF_HARM.slice(1).map(s => ({ value: s.value, label: s.label }))} />
          </Form.Item>
          <Form.Item name="description" label="危机情况描述" rules={[{ required: true }]}><TextArea rows={3} /></Form.Item>
          <Form.Item name="actionTaken" label="已采取措施"><TextArea rows={2} /></Form.Item>
          <Form.Item name="escalate" label="同时启动转介医院流程" valuePropName="checked"><Checkbox>勾选后危机事件直接进入“处置中”并标记送医</Checkbox></Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}

// 高危预约即时分流工作台
function TriageBoard() {
  const [rows, setRows] = useState<any[]>([]);
  const [detail, setDetail] = useState<any>(null);
  const [mode, setMode] = useState<'detail' | 'verify' | 'contact' | 'refer'>('detail');
  const [form] = Form.useForm();
  const [contactForm] = Form.useForm();
  const [referForm] = Form.useForm();

  const load = async () => {
    const data = await get('/worker/triage');
    setRows(data);
  };
  useEffect(() => { load(); }, []);
  const open = async (id: string) => { setDetail(await get(`/worker/triage/${id}`)); setMode('detail'); };
  const refresh = async () => { await load(); if (detail) { setDetail(await get(`/worker/triage/${detail.triage.id}`)); } };

  const submitVerify = async () => {
    const v = await form.validateFields();
    try {
      await post(`/worker/triage/${detail.triage.id}/verify`, {
        ...v,
        scaleScore: v.scaleScore === '' || v.scaleScore == null ? null : Number(v.scaleScore),
      });
      message.success('电话核实已记录（响应时间已留痕）'); setMode('detail'); form.resetFields(); refresh();
    } catch (e: any) { message.error(e.message); }
  };
  const submitContact = async () => {
    const v = await contactForm.validateFields();
    try {
      await post(`/worker/triage/${detail.triage.id}/emergency-contact`, v);
      message.success('紧急联系人响应已写入危机记录'); setMode('detail'); contactForm.resetFields(); refresh();
    } catch (e: any) { message.error(e.message); }
  };
  const submitRefer = async () => {
    const v = await referForm.validateFields();
    try {
      await post(`/worker/triage/${detail.triage.id}/refer`, v);
      message.success('已转介医院，等待回执闭环'); setMode('detail'); referForm.resetFields(); refresh();
    } catch (e: any) { message.error(e.message); }
  };
  const admit = (id: string) => {
    Modal.confirm({
      title: '转入社区咨询？',
      content: '将为其匹配具危机干预资质的咨询师并生成预约（咨询师可看到本次分诊风险画像）。',
      onOk: async () => {
        try {
          const r = await post(`/worker/triage/${id}/admit-community`, {});
          if (r.ok) { message.success(`已转入社区咨询，预约 ${r.appointmentId.slice(0, 8)}`); refresh(); }
        } catch (e: any) { message.error(e.message); }
      },
    });
  };

  const pendingCount = rows.filter(r => r.status === 'in_progress').length;

  return (
    <Card
      title={<Space><Badge count={pendingCount} showZero={false} color="red" />高危预约即时分流（关键词识别 · 跳过普通排班）</Space>}
      extra={<Button size="small" onClick={load}>刷新</Button>}
    >
      <Alert type="warning" showIcon style={{ marginBottom: 12 }}
        message="处置顺序：电话核实来访原因与量表 → 联系紧急联系人（响应自动进入危机记录）→ 转介医院 或 风险可控后转入社区咨询；响应人、响应时间、转介结果全程留痕。" />
      <Table
        rowKey="id" dataSource={rows} pagination={false}
        columns={[
          { title: '提交时间', render: (_, r) => fmtMin(r.requestCreatedAt) },
          { title: '居民', dataIndex: 'residentName' },
          { title: '主题', render: (_, r) => <><Tag>{r.topicCategory}</Tag><div style={{ maxWidth: 260 }}>{r.topic}</div></> },
          {
            title: '命中关键词', dataIndex: 'keywords',
            render: (k: string[]) => k?.length ? k.map(x => <Tag key={x} color="red">{x}</Tag>) : <span className="muted">表单危机等级</span>,
          },
          { title: '紧急联系人', render: (_, r) => r.emergencyContactName ? `${r.emergencyContactName}（${r.emergencyContactRelation}）` : <Tag color="orange">未填写</Tag> },
          { title: '响应社工', render: (_, r) => r.socialWorkerName || <Tag color="red">待响应</Tag> },
          { title: '状态', dataIndex: 'status', render: (v: string) => statusTag(TRIAGE_STATUS, v) },
          {
            title: '操作', render: (_, r) => (
              <Space wrap>
                <Button size="small" type="primary" danger={r.status === 'in_progress'} onClick={() => open(r.id)}>处置</Button>
              </Space>
            ),
          },
        ]}
      />

      <Modal open={!!detail && mode === 'detail'} title="高危分流处置单" width={820} footer={null} onCancel={() => setDetail(null)}>
        {detail && (
          <>
            <Descriptions size="small" bordered column={2}>
              <Descriptions.Item label="居民">{detail.resident?.realName}（{detail.resident?.phone}）</Descriptions.Item>
              <Descriptions.Item label="风险等级">{urgencyTag(detail.triage.riskLevel)}</Descriptions.Item>
              <Descriptions.Item label="提交时间">{fmtDateTime(detail.request?.createdAt)}</Descriptions.Item>
              <Descriptions.Item label="社工响应时间">{detail.triage.respondedAt ? fmtDateTime(detail.triage.respondedAt) : <Tag color="red">尚未响应</Tag>}</Descriptions.Item>
              <Descriptions.Item label="来访主诉" span={2}>{detail.request?.topic}</Descriptions.Item>
              <Descriptions.Item label="命中关键词" span={2}>{(detail.request?.triageKeywords || []).map((k: string) => <Tag key={k} color="red">{k}</Tag>)}</Descriptions.Item>
              <Descriptions.Item label="紧急联系人" span={2}>
                {detail.triage.emergencyContactName
                  ? `${detail.triage.emergencyContactName}（${detail.triage.emergencyContactRelation}）${detail.triage.emergencyContactPhone}`
                  : <Tag color="orange">未填写，需补录</Tag>}
              </Descriptions.Item>
              {detail.triage.emergencyContactResponse && (
                <Descriptions.Item label="联系人响应" span={2}>
                  {detail.triage.emergencyContactReached ? <Tag color="green">已联系上</Tag> : <Tag>未联系上</Tag>}
                  {detail.triage.emergencyContactResponse}
                  <div className="muted">{fmtDateTime(detail.triage.emergencyContactRespondedAt)}</div>
                </Descriptions.Item>
              )}
              {detail.triage.visitReason && (
                <>
                  <Descriptions.Item label="来访原因（核实）" span={2}>{detail.triage.visitReason}</Descriptions.Item>
                  <Descriptions.Item label="量表结果" span={2}>
                    {detail.triage.scaleResult || '—'}{detail.triage.scaleScore != null ? `（${detail.triage.scaleScore}分）` : ''}
                  </Descriptions.Item>
                </>
              )}
              <Descriptions.Item label="处置状态" span={2}>{statusTag(TRIAGE_STATUS, detail.triage.status)}</Descriptions.Item>
              {detail.triage.actionNote && <Descriptions.Item label="处置记录" span={2}>{detail.triage.actionNote}</Descriptions.Item>}
            </Descriptions>

            <Card size="small" style={{ marginTop: 10 }} title="服务链时间线"><ChainTimeline events={detail.timeline} /></Card>

            {detail.triage.status === 'in_progress' && (
              <Space style={{ marginTop: 10 }} wrap>
                <Button type="primary" onClick={() => setMode('verify')}>① 电话核实（来访原因/量表/联系人）</Button>
                <Button onClick={() => setMode('contact')}>② 联系紧急联系人</Button>
                <Button danger onClick={() => setMode('refer')}>③ 转介医院</Button>
                <Button type="primary" ghost disabled={!detail.triage.visitReason} onClick={() => admit(detail.triage.id)}>④ 风险可控，转入社区咨询</Button>
              </Space>
            )}
          </>
        )}
      </Modal>

      <Modal open={mode === 'verify'} title="电话核实" width={620} onOk={submitVerify} onCancel={() => setMode('detail')}>
        <Form form={form} layout="vertical" initialValues={{
          riskLevel: detail?.triage.riskLevel || 'high',
          emergencyContactName: detail?.triage.emergencyContactName,
          emergencyContactRelation: detail?.triage.emergencyContactRelation,
          emergencyContactPhone: detail?.triage.emergencyContactPhone,
        }}>
          <Form.Item name="visitReason" label="来访原因（电话核实情况）" rules={[{ required: true }]}><TextArea rows={3} /></Form.Item>
          <Space size="large">
            <Form.Item name="scaleResult" label="量表名称/结果"><Input placeholder="如 PHQ-9 中度 / 自杀风险评估 高" /></Form.Item>
            <Form.Item name="scaleScore" label="量表分值"><Input type="number" placeholder="如 18" /></Form.Item>
            <Form.Item name="riskLevel" label="风险等级"><Select style={{ width: 130 }} options={URGENCY.map(u => ({ value: u.value, label: u.label }))} /></Form.Item>
          </Space>
          <Space size="large">
            <Form.Item name="emergencyContactName" label="紧急联系人"><Input /></Form.Item>
            <Form.Item name="emergencyContactRelation" label="关系"><Input /></Form.Item>
            <Form.Item name="emergencyContactPhone" label="电话"><Input /></Form.Item>
          </Space>
          <Form.Item name="note" label="其他处置备注"><TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>

      <Modal open={mode === 'contact'} title="联系紧急联系人（响应写入危机记录）" onOk={submitContact} onCancel={() => setMode('detail')}>
        <Form form={contactForm} layout="vertical" initialValues={{
          reached: true,
          contactName: detail?.triage.emergencyContactName,
          relation: detail?.triage.emergencyContactRelation,
          phone: detail?.triage.emergencyContactPhone,
        }}>
          <Space size="large">
            <Form.Item name="contactName" label="联系人姓名"><Input /></Form.Item>
            <Form.Item name="relation" label="关系"><Input /></Form.Item>
            <Form.Item name="phone" label="电话"><Input /></Form.Item>
          </Space>
          <Form.Item name="reached" label="是否联系上" valuePropName="checked"><Checkbox>已取得联系</Checkbox></Form.Item>
          <Form.Item name="response" label="联系人响应/到场情况" rules={[{ required: true }]}>
            <TextArea rows={3} placeholder="如：配偶已知情，承诺24小时陪护并陪同就医；或电话无人接听，已短信留言…" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal open={mode === 'refer'} title="转介医院（记录转介结果）" onOk={submitRefer} onCancel={() => setMode('detail')}>
        <Form form={referForm} layout="vertical" initialValues={{ targetOrg: '市精神卫生中心', department: '精神科急诊' }}>
          <Space size="large">
            <Form.Item name="targetOrg" label="目标机构"><Input /></Form.Item>
            <Form.Item name="department" label="科室"><Input /></Form.Item>
          </Space>
          <Form.Item name="reason" label="转介原因" rules={[{ required: true }]}>
            <TextArea rows={3} placeholder="如：自杀计划具体、社会支持不足，需精神科急诊评估住院" />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}

export default function WorkerPages() {
  return (
    <Tabs
      items={[
        { key: 'triage', label: <span><Badge status="error" />高危即时分流</span>, children: <TriageBoard /> },
        { key: 'appts', label: '初筛与预约', children: <Appointments /> },
        { key: 'crisis', label: <span>危机处置台</span>, children: <CrisisBoard /> },
      ]}
    />
  );
}
