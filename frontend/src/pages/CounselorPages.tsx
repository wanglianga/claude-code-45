import { useEffect, useState } from 'react';
import {
  Tabs, Card, Table, Tag, Button, Space, Modal, Form, Select, Input, DatePicker, message,
  Descriptions, Alert, Timeline, List, Badge,
} from 'antd';
import dayjs from 'dayjs';
import { get, post } from '../api';
import {
  urgencyTag, statusTag, APPT_STATUS, URGENCY, CRISIS_STATUS, REFERRAL_RESULT,
} from '../labels';
import ChainTimeline from '../ChainTimeline';
import { fmtTime, fmtMin, fmtDateTime } from '../time';

const { TextArea } = Input;

function Schedule() {
  const [slots, setSlots] = useState<any[]>([]);
  const [leaves, setLeaves] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const load = async () => {
    setSlots(await get('/counselor/slots'));
    setLeaves(await get('/counselor/leave'));
  };
  useEffect(() => { load(); }, []);

  const add = async () => {
    const v = await form.validateFields();
    await post('/counselor/slots', {
      date: v.date.format('YYYY-MM-DD'),
      startTime: v.range[0].format('HH:mm'),
      endTime: v.range[1].format('HH:mm'),
    });
    message.success('可约时段已发布'); setOpen(false); form.resetFields(); load();
  };
  const remove = async (s: any) => { await post(`/counselor/slots/${s.id}/remove`); message.success('已删除'); load(); };

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      <Card title="我的可约时段" extra={<Button type="primary" onClick={() => setOpen(true)}>发布时段</Button>}>
        <Table
          rowKey="id" dataSource={slots} pagination={{ pageSize: 10 }}
          columns={[
            { title: '日期', dataIndex: 'date', sorter: (a, b) => a.date.localeCompare(b.date) },
            { title: '时间', render: (_, r) => `${r.startTime} - ${r.endTime}` },
            { title: '状态', dataIndex: 'status', render: (v: string) =>
              v === 'available' ? <Tag color="green">可约</Tag> : v === 'booked' ? <Tag color="blue">已约</Tag> : <Tag color="red">冻结（请假）</Tag> },
            { title: '操作', render: (_, r) => r.status === 'available' &&
              <Button size="small" danger onClick={() => remove(r)}>删除</Button> },
          ]}
        />
      </Card>
      <Card title="我的请假记录（审批通过后系统自动冻结时段并改约/挂起受影响预约）">
        <Table
          rowKey="id" dataSource={leaves} pagination={false}
          columns={[
            { title: '起止', render: (_, r) => `${r.startDate} ~ ${r.endDate}` },
            { title: '事由', dataIndex: 'reason' },
            { title: '状态', dataIndex: 'status', render: (v: string) =>
              v === 'pending' ? <Tag color="gold">待审批</Tag> : v === 'approved' ? <Tag color="green">已批准</Tag> : <Tag color="red">已驳回</Tag> },
          ]}
        />
      </Card>
      <Modal open={open} title="发布可约时段" onOk={add} onCancel={() => setOpen(false)}>
        <Form form={form} layout="vertical">
          <Form.Item name="date" label="日期" rules={[{ required: true }]}>
            <DatePicker style={{ width: '100%' }} minDate={dayjs()} />
          </Form.Item>
          <Form.Item name="range" label="起止时间" rules={[{ required: true }]}>
            <TimeRangePicker />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}

// antd TimePicker.RangePicker 包装
import { TimePicker } from 'antd';
function TimeRangePicker(props: any) {
  return <TimePicker.RangePicker format="HH:mm" minuteStep={30} {...props} />;
}

function Cases() {
  const [rows, setRows] = useState<any[]>([]);
  const [detail, setDetail] = useState<any>(null);
  const [recOpen, setRecOpen] = useState(false);
  const [refOpen, setRefOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [form] = Form.useForm();
  const [refForm] = Form.useForm();
  const [leaveForm] = Form.useForm();

  const load = async () => setRows(await get('/counselor/appointments'));
  useEffect(() => { load(); }, []);
  const openDetail = async (id: string) => setDetail(await get(`/counselor/appointments/${id}`));

  const addRecord = async () => {
    const v = await form.validateFields();
    await post(`/counselor/appointments/${detail.appointment.id}/records`, {
      ...v,
      nextAppointmentAt: v.nextAppointmentAt ? v.nextAppointmentAt.toISOString() : null,
    });
    message.success('咨询记录已保存（按权限保护：社工仅见风险评估，居民仅见下次计划）');
    setRecOpen(false); form.resetFields(); setDetail(await get(`/counselor/appointments/${detail.appointment.id}`)); load();
  };
  const complete = async (id: string) => {
    await post(`/counselor/appointments/${id}/complete`);
    message.success('咨询已结束，进入随访与评价'); setDetail(null); load();
  };
  const refer = async () => {
    const v = await refForm.validateFields();
    await post(`/counselor/appointments/${detail.appointment.id}/referral`, v);
    message.success('已转介，服务链转入医院衔接与回执跟踪'); setRefOpen(false); refForm.resetFields();
    setDetail(await get(`/counselor/appointments/${detail.appointment.id}`)); load();
  };
  const requestLeave = async () => {
    const v = await leaveForm.validateFields();
    await post('/counselor/leave', { startDate: v.range[0].format('YYYY-MM-DD'), endDate: v.range[1].format('YYYY-MM-DD'), reason: v.reason });
    message.success('请假申请已提交，等待管理者审批'); setLeaveOpen(false); leaveForm.resetFields();
  };

  return (
    <Card
      title={<Space><Badge count={rows.filter(r => ['pending', 'confirmed'].includes(r.status)).length} showZero={false} />我的咨询个案</Space>}
      extra={<Button onClick={() => setLeaveOpen(true)}>申请请假</Button>}
    >
      <Table
        rowKey="id" dataSource={rows} pagination={{ pageSize: 8 }}
        columns={[
          { title: '时间', render: (_, r) => fmtMin(r.scheduledAt) },
          { title: '居民', dataIndex: 'residentName' },
          { title: '主题', render: (_, r) => <><Tag>{r.topicCategory}</Tag>{r.topic?.slice(0, 14)}…</> },
          { title: '风险', dataIndex: 'crisisLevel', render: urgencyTag },
          { title: '状态', dataIndex: 'status', render: (v: string) => statusTag(APPT_STATUS, v) },
          {
            title: '操作', width: 200, render: (_, r) => (
              <Space wrap>
                <Button size="small" onClick={() => openDetail(r.id)}>详情/记录</Button>
                {['confirmed', 'in_progress'].includes(r.status) &&
                  <Button size="small" type="primary" onClick={async () => { await openDetail(r.id); setRecOpen(true); }}>写记录</Button>}
              </Space>
            ),
          },
        ]}
      />

      <Modal open={!!detail && !recOpen && !refOpen} title="个案详情（完整咨询档案）" width={820} footer={null} onCancel={() => setDetail(null)}>
        {detail && (
          <>
            {detail.triage && (
              <Alert
                style={{ marginBottom: 10 }} type="error" showIcon
                message={<Space>高危分诊风险画像（接单前必读）{urgencyTag(detail.triage.riskLevel)}</Space>}
                description={
                  <Descriptions size="small" column={1} style={{ marginTop: 6 }}>
                    <Descriptions.Item label="社工电话核实">
                      {detail.triage.visitReason}
                      <div className="muted">响应人：{detail.triage.socialWorkerName}｜响应时间：{detail.triage.respondedAt ? fmtMin(detail.triage.respondedAt) : '—'}</div>
                    </Descriptions.Item>
                    {detail.triage.scaleResult && <Descriptions.Item label="量表结果">{detail.triage.scaleResult}{detail.triage.scaleScore != null ? `（${detail.triage.scaleScore}分）` : ''}</Descriptions.Item>}
                    <Descriptions.Item label="紧急联系人">
                      {detail.triage.emergencyContactName
                        ? `${detail.triage.emergencyContactName}（${detail.triage.emergencyContactRelation}）${detail.triage.emergencyContactPhone}`
                        : '未填写'}
                      {detail.triage.emergencyContactResponse && (
                        <div>联系人响应：{detail.triage.emergencyContactReached ? '已联系上' : '未联系上'}｜{detail.triage.emergencyContactResponse}</div>
                      )}
                    </Descriptions.Item>
                    {detail.triage.actionNote && <Descriptions.Item label="分流处置记录">{detail.triage.actionNote}</Descriptions.Item>}
                  </Descriptions>
                }
              />
            )}
            {['high', 'crisis'].includes(detail.appointment.crisisLevel) && !detail.triage &&
              <Alert type="error" showIcon style={{ marginBottom: 10 }} message="危机个案：记录与处置按危机通道管理" />}
            <Descriptions size="small" bordered column={2}>
              <Descriptions.Item label="居民">{detail.resident.realName}（{detail.resident.age}岁，{detail.resident.phone}）</Descriptions.Item>
              <Descriptions.Item label="状态">{statusTag(APPT_STATUS, detail.appointment.status)}</Descriptions.Item>
              <Descriptions.Item label="主诉" span={2}>{detail.request?.topic}</Descriptions.Item>
              <Descriptions.Item label="既往咨询" span={2}>{detail.request?.priorCounseling || '无'}</Descriptions.Item>
              {detail.screening && <>
                <Descriptions.Item label="社工初筛风险">{urgencyTag(detail.screening.crisisLevel)}</Descriptions.Item>
                <Descriptions.Item label="家属参与">{detail.screening.familyInvolved ? (detail.screening.familyMembers || []).join('、') || '是' : '否'}</Descriptions.Item>
                <Descriptions.Item label="初筛评估" span={2}>{detail.screening.riskAssessment} {detail.screening.recommendation}</Descriptions.Item>
              </>}
            </Descriptions>

            {detail.records?.length > 0 && (
              <Card size="small" style={{ marginTop: 10 }} title="咨询记录（保密，仅承接咨询师可见全文）">
                {detail.records.map((r: any) => (
                  <Descriptions key={r.id} size="small" column={1} bordered style={{ marginBottom: 8 }}>
                    <Descriptions.Item label="时间">{fmtDateTime(r.createdAt)}｜主题：{r.topic}｜风险评级 {URGENCY.find(u => u.value === r.riskLevel)?.label}</Descriptions.Item>
                    <Descriptions.Item label="咨询过程（保密）">{r.content}</Descriptions.Item>
                    <Descriptions.Item label="风险评估（社工可见级）">{r.riskAssessment || '—'}</Descriptions.Item>
                    <Descriptions.Item label="干预建议（保密）">{r.interventionAdvice}</Descriptions.Item>
                    <Descriptions.Item label="下次计划（居民可见）">
                      {r.nextPlan || '—'}{r.nextAppointmentAt ? `（${fmtDateTime(r.nextAppointmentAt)}）` : ''}
                    </Descriptions.Item>
                  </Descriptions>
                ))}
              </Card>
            )}

            {detail.followups?.length > 0 && (
              <Card size="small" style={{ marginTop: 8 }} title="社工随访">
                {detail.followups.map((f: any) => (
                  <div key={f.id}>· {fmtTime(f.createdAt).slice(5,10)}（风险{URGENCY.find(u => u.value === f.riskLevel)?.label}）：{f.content}</div>
                ))}
              </Card>
            )}

            {detail.referrals?.length > 0 && detail.referrals.map((rf: any) => (
              <Alert
                key={rf.id} style={{ marginTop: 8 }} type="warning" showIcon
                message={<Space>转介 {rf.targetOrg}·{rf.department}
                  <Tag color={REFERRAL_RESULT[rf.outcome || rf.status]?.color}>{REFERRAL_RESULT[rf.outcome || rf.status]?.label}</Tag></Space>}
                description={<>{rf.reason}{rf.receiptText && <div style={{ marginTop: 4 }}>医院回执：{rf.receiptText}</div>}</>}
              />
            ))}

            {detail.crises?.length > 0 && (
              <Card size="small" style={{ marginTop: 8 }} title="危机事件">
                {detail.crises.map((c: any) => (
                  <div key={c.id}>
                    <Tag color="red">{CRISIS_STATUS[c.status]?.label}</Tag>{c.description}
                    {c.actionTaken && <div className="muted">处置：{c.actionTaken}</div>}
                  </div>
                ))}
              </Card>
            )}

            {detail.familyRequests?.length > 0 && (
              <Card size="small" style={{ marginTop: 8 }} title="家属查看记录申请">
                {detail.familyRequests.map((f: any) => (
                  <div key={f.id}>· {f.applicantName}（{f.relation}）：{f.reason} → {f.status === 'pending' ? <Tag color="gold">待管理者审批</Tag> : f.status === 'approved' ? <Tag color="green">已批准（72h脱敏）</Tag> : <Tag color="red">已驳回</Tag>}</div>
                ))}
              </Card>
            )}

            <Card size="small" style={{ marginTop: 8 }} title="服务链时间线"><ChainTimeline events={detail.timeline} /></Card>

            <Space style={{ marginTop: 10 }} wrap>
              {['confirmed', 'in_progress'].includes(detail.appointment.status) && <>
                <Button type="primary" onClick={() => setRecOpen(true)}>新增咨询记录</Button>
                <Button onClick={() => setRefOpen(true)}>转介精神专科</Button>
                {detail.records?.length > 0 && <Button type="primary" ghost onClick={() => complete(detail.appointment.id)}>结束咨询</Button>}
              </>}
            </Space>
          </>
        )}
      </Modal>

      <Modal open={recOpen} title="咨询记录（主题·风险评估·干预建议·下次计划）" width={680}
        onOk={addRecord} onCancel={() => setRecOpen(false)} okText="保存记录">
        <Alert type="info" showIcon style={{ marginBottom: 10 }}
          message="若风险评级为紧急/危机，系统将自动开立危机事件并通知社工，个案转入危机通道" />
        <Form form={form} layout="vertical" initialValues={{ riskLevel: 'low' }}>
          <Form.Item name="topic" label="本次主题" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="content" label="咨询过程记录（保密字段）" rules={[{ required: true }]}><TextArea rows={3} /></Form.Item>
          <Space size="large">
            <Form.Item name="riskLevel" label="风险评估等级" rules={[{ required: true }]} style={{ minWidth: 160 }}>
              <Select options={URGENCY.map(u => ({ value: u.value, label: u.label }))} />
            </Form.Item>
          </Space>
          <Form.Item name="riskAssessment" label="风险评估说明"><TextArea rows={2} placeholder="用量表/观察描述风险，社工可见" /></Form.Item>
          <Form.Item name="interventionAdvice" label="干预建议（保密字段）" rules={[{ required: true }]}><TextArea rows={3} /></Form.Item>
          <Form.Item name="nextPlan" label="下次计划（居民可见）"><TextArea rows={2} /></Form.Item>
          <Form.Item name="nextAppointmentAt" label="下次预约时间"><DatePicker showTime minuteStep={30} /></Form.Item>
        </Form>
      </Modal>

      <Modal open={refOpen} title="转介精神专科" onOk={refer} onCancel={() => setRefOpen(false)}>
        <Form form={refForm} layout="vertical" initialValues={{ type: 'hospital_psychiatry', targetOrg: '市精神卫生中心', department: '精神科门诊' }}>
          <Space size="large">
            <Form.Item name="type" label="转介类型">
              <Select style={{ width: 180 }} options={[
                { value: 'hospital_psychiatry', label: '精神专科医院' },
                { value: 'community_internal', label: '社区内部转介' },
                { value: 'crisis_hotline', label: '危机热线' },
              ]} />
            </Form.Item>
            <Form.Item name="targetOrg" label="目标机构"><Input /></Form.Item>
            <Form.Item name="department" label="科室"><Input /></Form.Item>
          </Space>
          <Form.Item name="reason" label="转介原因（风险超出社区咨询范围等）" rules={[{ required: true }]}><TextArea rows={3} /></Form.Item>
        </Form>
      </Modal>

      <Modal open={leaveOpen} title="咨询师请假" onOk={requestLeave} onCancel={() => setLeaveOpen(false)}>
        <Alert type="info" showIcon style={{ marginBottom: 10 }}
          message="审批通过后：区间内空闲时段冻结；已有预约自动改约同资质咨询师（危机单须危机资质），无替代资源则挂起待排班" />
        <Form form={leaveForm} layout="vertical">
          <Form.Item name="range" label="请假起止日期" rules={[{ required: true }]}>
            <DatePicker.RangePicker style={{ width: '100%' }} minDate={dayjs()} />
          </Form.Item>
          <Form.Item name="reason" label="事由"><TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}

export default function CounselorPages() {
  return (
    <Tabs
      items={[
        { key: 'cases', label: '我的咨询个案', children: <Cases /> },
        { key: 'schedule', label: '排班与请假', children: <Schedule /> },
      ]}
    />
  );
}
