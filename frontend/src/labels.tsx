import React from 'react';
import { Tag } from 'antd';

export const TOPIC_CATEGORIES = [
  '情绪压力', '婚姻家庭', '亲子教育', '职场人际', '睡眠问题', '抑郁焦虑', '危机干预', '其他',
];

export const URGENCY = [
  { value: 'low', label: '普通', color: 'green' },
  { value: 'medium', label: '较急', color: 'gold' },
  { value: 'high', label: '紧急', color: 'orange' },
  { value: 'crisis', label: '危机', color: 'red' },
];

export const SELF_HARM = [
  { value: 'none', label: '无', color: 'green' },
  { value: 'ideation', label: '有消极念头', color: 'gold' },
  { value: 'plan', label: '有具体计划', color: 'orange' },
  { value: 'recent_act', label: '近期有行为', color: 'red' },
];

export const APPT_STATUS: Record<string, { label: string; color: string }> = {
  pending: { label: '待初筛', color: 'gold' },
  confirmed: { label: '待咨询', color: 'blue' },
  in_progress: { label: '咨询中', color: 'geekblue' },
  completed: { label: '已完成', color: 'green' },
  no_show: { label: '爽约', color: 'default' },
  cancelled: { label: '已取消', color: 'default' },
  referred: { label: '已转介', color: 'purple' },
  leave_rescheduled: { label: '请假挂起待排班', color: 'volcano' },
};

export const REQ_STATUS: Record<string, { label: string; color: string }> = {
  submitted: { label: '待匹配', color: 'gold' },
  matched: { label: '已生成预约', color: 'blue' },
  converted: { label: '已进入服务', color: 'green' },
  crisis_handled: { label: '危机处置中', color: 'red' },
  cancelled: { label: '已取消', color: 'default' },
};

export const CRISIS_STATUS: Record<string, { label: string; color: string }> = {
  open: { label: '待处置', color: 'red' },
  processing: { label: '处置中', color: 'orange' },
  resolved: { label: '已解除', color: 'green' },
};

export const REFERRAL_RESULT: Record<string, { label: string; color: string }> = {
  accepted: { label: '医院接诊', color: 'blue' },
  hospitalized: { label: '收治住院', color: 'purple' },
  outpatient: { label: '门诊治疗', color: 'cyan' },
  declined: { label: '退回/拒收', color: 'red' },
  submitted: { label: '已转出待回执', color: 'gold' },
  draft: { label: '草稿', color: 'default' },
};

export const urgencyTag = (v: string) => {
  const o = URGENCY.find(x => x.value === v);
  return <Tag color={o?.color}>{o?.label || v}</Tag>;
};
export const riskTag = (v: string) => {
  const o = SELF_HARM.find(x => x.value === v);
  return <Tag color={o?.color}>{o?.label || v}</Tag>;
};
export const statusTag = (map: Record<string, { label: string; color: string }>, v: string) => {
  const o = map[v];
  return <Tag color={o?.color}>{o?.label || v}</Tag>;
};

export const ROLE_LABEL: Record<string, string> = {
  resident: '居民', social_worker: '社工', counselor: '咨询师', admin: '社区管理者',
};

export const CHAIN_TYPE_LABEL: Record<string, string> = {
  request: '提交申请', match: '智能匹配', crisis_flag: '危机标记',
  screening: '咨询前初筛', record: '咨询记录', complete: '咨询结束',
  followup: '随访', rating: '服务评价', referral: '转介', receipt: '转介回执',
  crisis: '危机事件', crisis_process: '危机处置', crisis_resolve: '危机解除',
  risk_upgrade: '风险升级', family_request: '家属申请', family_review: '家属申请审批',
  family_view: '家属查看记录', family_view_denied: '家属查看被拒',
  no_show: '爽约登记', leave_reschedule: '请假改约', leave_stranded: '请假挂起',
};
