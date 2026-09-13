import {
  Entity, PrimaryGeneratedColumn, Column, OneToOne, ManyToOne, OneToMany, JoinColumn, Index,
} from 'typeorm';

// ---------- 枚举（字符串常量，便于数据库阅读） ----------
export type Role = 'resident' | 'social_worker' | 'counselor' | 'admin';
export const ROLES = ['resident', 'social_worker', 'counselor', 'admin'] as const;

// 紧急程度：普通 / 较急 / 紧急 / 危机
export type Urgency = 'low' | 'medium' | 'high' | 'crisis';
// 自伤风险：无 / 有念头 / 有计划 / 近期有行为
export type SelfHarmRisk = 'none' | 'ideation' | 'plan' | 'recent_act';

export const TOPIC_CATEGORIES = [
  '情绪压力', '婚姻家庭', '亲子教育', '职场人际', '睡眠问题', '抑郁焦虑', '危机干预', '其他',
] as const;

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index({ unique: true })
  @Column() username: string;
  @Column() passwordHash: string;
  @Column() realName: string;
  @Column({ type: 'varchar' }) role: Role;
  @Column({ default: '' }) phone: string;
  @Column({ default: '阳光街道社区' }) community: string;
  @Column({ default: true }) active: boolean;
  @Column({ type: 'timestamptz', default: () => 'now()' }) createdAt: Date;

  @OneToOne('CounselorProfile', 'user') counselorProfile?: any;
}

@Entity('counselor_profiles')
export class CounselorProfile {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() userId: string;
  @Column({ default: '心理咨询师' }) title: string;
  @Column({ default: '' }) qualifications: string;              // 资质证书
  @Column({ type: 'simple-json', default: [] }) specialties: string[]; // 擅长主题
  @Column({ type: 'int', default: 3 }) yearsExperience: number;
  @Column({ default: false }) crisisCertified: boolean;          // 是否具备危机干预资质
  @Column({ type: 'simple-json', default: [] }) hospitalPartners: string[]; // 合作医院
  @Column({ default: true }) active: boolean;

  @OneToOne('User', 'counselorProfile') @JoinColumn({ name: 'user_id' })
  user: User;
}

// 咨询师可约时段 / 请假冻结时段
@Entity('availability_slots')
export class AvailabilitySlot {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() counselorId: string;
  @Column({ type: 'date' }) date: string;          // YYYY-MM-DD
  @Column({ type: 'varchar', length: 5 }) startTime: string; // HH:mm
  @Column({ type: 'varchar', length: 5 }) endTime: string;
  @Column({ type: 'varchar', default: 'available' }) status: 'available' | 'booked' | 'blocked';
  @Column({ type: 'uuid', nullable: true }) appointmentId: string | null;
}

// 居民预约申请
@Entity('booking_requests')
export class BookingRequest {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() residentId: string;
  @Column({ type: 'varchar' }) topicCategory: string;
  @Column() topic: string;                         // 咨询主题描述
  @Column({ type: 'int' }) age: number;
  @Column({ type: 'varchar' }) urgency: Urgency;
  @Column({ type: 'varchar' }) selfHarmRisk: SelfHarmRisk;
  @Column({ type: 'text', default: '' }) priorCounseling: string; // 既往咨询
  @Column({ type: 'simple-json', default: [] }) preferredTimes: string[]; // 可约时间
  @Column({ default: false }) confidentialityAuthorized: boolean; // 保密授权
  @Column({ default: false }) crisisFlag: boolean;
  @Column({ type: 'simple-json', default: [] }) triageKeywords: string[]; // 命中的自伤风险关键词
  @Column({ default: '' }) emergencyContactName: string;     // 紧急联系人
  @Column({ default: '' }) emergencyContactRelation: string;
  @Column({ default: '' }) emergencyContactPhone: string;
  @Column({ type: 'varchar', default: 'submitted' })
  status: 'submitted' | 'triage' | 'matched' | 'converted' | 'crisis_handled' | 'cancelled';
  @Column({ type: 'uuid', nullable: true }) matchedCounselorId: string | null;
  @Column({ type: 'text', default: '' }) adminNote: string;
  @Column({ type: 'timestamptz', default: () => 'now()' }) createdAt: Date;

  @ManyToOne('User') @JoinColumn({ name: 'resident_id' }) resident: User;
  @OneToMany('Appointment', 'request') appointments: any[];
}

export type AppointmentStatus =
  | 'pending'        // 已生成待初筛
  | 'confirmed'      // 初筛通过，待咨询
  | 'in_progress'    // 咨询中
  | 'completed'      // 已完成
  | 'no_show'        // 爽约
  | 'cancelled'      // 取消
  | 'referred'       // 已转介
  | 'leave_rescheduled'; // 咨询师请假改约

@Entity('appointments')
export class Appointment {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid', nullable: true }) requestId: string | null;
  @Column() residentId: string;
  @Column() counselorId: string;
  @Column({ type: 'uuid', nullable: true }) socialWorkerId: string | null;
  @Column({ type: 'uuid', nullable: true }) slotId: string | null;
  @Column({ type: 'timestamptz' }) scheduledAt: Date;
  @Column({ type: 'int', default: 60 }) durationMin: number;
  @Column({ type: 'varchar', default: 'offline' }) mode: string;
  @Column({ default: '社区心理服务室' }) location: string;
  @Column({ type: 'varchar' }) crisisLevel: Urgency;
  @Column({ type: 'varchar', default: 'pending' }) status: AppointmentStatus;
  @Column({ type: 'text', default: '' }) statusReason: string;
  @Column({ type: 'timestamptz', nullable: true }) completedAt: Date | null;
  @Column({ type: 'timestamptz', default: () => 'now()' }) createdAt: Date;

  @ManyToOne('BookingRequest', 'appointments') @JoinColumn({ name: 'request_id' }) request: BookingRequest;
  @ManyToOne('User') @JoinColumn({ name: 'resident_id' }) resident: User;
  @ManyToOne('User') @JoinColumn({ name: 'counselor_id' }) counselor: User;
  @OneToMany('ConsultationRecord', 'appointment') records: any[];
  @OneToMany('ServiceChainEvent', 'appointment') chainEvents: any[];
}

// 社工初筛
@Entity('screenings')
export class Screening {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ unique: true }) appointmentId: string;
  @Column() socialWorkerId: string;
  @Column({ default: true }) suitableCommunity: boolean;   // 是否适合社区咨询
  @Column({ default: false }) familyInvolved: boolean;     // 是否需要家属参与
  @Column({ type: 'simple-json', default: [] }) familyMembers: string[];
  @Column({ default: false }) selfHarmConfirmed: boolean;
  @Column({ type: 'varchar', default: 'medium' }) crisisLevel: Urgency;
  @Column({ type: 'text', default: '' }) riskAssessment: string;
  @Column({ type: 'varchar', default: 'suitable' })
  decision: 'suitable' | 'family_involved' | 'refer_hospital';
  @Column({ type: 'text', default: '' }) recommendation: string;
  @Column({ type: 'timestamptz', default: () => 'now()' }) createdAt: Date;

  @ManyToOne('Appointment') @JoinColumn({ name: 'appointment_id' }) appointment: Appointment;
}

// 高危预约即时分流：自伤风险关键词触发，跳过普通排班，由社工先电话核实/联系紧急联系人/转介医院
@Entity('high_risk_triages')
export class HighRiskTriage {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ unique: true }) requestId: string;
  @Column() residentId: string;
  @Column({ type: 'uuid', nullable: true }) socialWorkerId: string | null;
  @Column() socialWorkerName: string;
  // 来访原因（社工电话核实记录）
  @Column({ type: 'text' }) visitReason: string;
  // 量表结果（如 PHQ-9 / 自杀风险评估）
  @Column({ type: 'text', default: '' }) scaleResult: string;
  @Column({ type: 'int', nullable: true }) scaleScore: number | null;
  // 紧急联系人
  @Column({ default: '' }) emergencyContactName: string;
  @Column({ default: '' }) emergencyContactRelation: string;
  @Column({ default: '' }) emergencyContactPhone: string;
  // 紧急联系人是否响应
  @Column({ default: false }) emergencyContactReached: boolean;
  @Column({ type: 'text', default: '' }) emergencyContactResponse: string;
  @Column({ type: 'timestamptz', nullable: true }) emergencyContactRespondedAt: Date | null;
  // 风险分级与处置
  @Column({ type: 'varchar' }) riskLevel: Urgency;
  @Column({ type: 'varchar', default: 'in_progress' })
  status: 'in_progress' | 'referred' | 'admitted_community' | 'closed';
  @Column({ type: 'text', default: '' }) actionNote: string;
  @Column({ type: 'uuid', nullable: true }) referralId: string | null;
  @Column({ type: 'uuid', nullable: true }) appointmentId: string | null; // 转入社区咨询后生成的预约
  @Column({ type: 'timestamptz', nullable: true }) respondedAt: Date | null;  // 社工首次响应时间
  @Column({ type: 'timestamptz', nullable: true }) completedAt: Date | null;  // 分流完成时间
  @Column({ type: 'timestamptz', default: () => 'now()' }) createdAt: Date;
}

// 咨询记录（按权限保护）
@Entity('consultation_records')
export class ConsultationRecord {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() appointmentId: string;
  @Column() counselorId: string;
  @Column() topic: string;
  @Column({ type: 'text' }) content: string;                // 咨询过程（敏感）
  @Column({ type: 'text', default: '' }) riskAssessment: string; // 风险评估（社工可见）
  @Column({ type: 'varchar', default: 'low' }) riskLevel: Urgency;
  @Column({ type: 'text' }) interventionAdvice: string;     // 干预建议（敏感）
  @Column({ type: 'text', default: '' }) nextPlan: string;  // 下次计划（居民可见）
  @Column({ type: 'timestamptz', nullable: true }) nextAppointmentAt: Date | null;
  @Column({ default: true }) confidential: boolean;
  @Column({ type: 'timestamptz', default: () => 'now()' }) createdAt: Date;

  @ManyToOne('Appointment', 'records') @JoinColumn({ name: 'appointment_id' })
  appointment: Appointment;
}

// 转介单
@Entity('referrals')
export class Referral {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid', nullable: true }) appointmentId: string | null;
  @Column({ type: 'uuid', nullable: true }) requestId: string | null; // 高危分流阶段（尚未生成预约）的转介
  @Column({ type: 'varchar', default: 'hospital_psychiatry' })
  type: 'hospital_psychiatry' | 'community_internal' | 'crisis_hotline';
  @Column({ default: '市精神卫生中心' }) targetOrg: string;
  @Column({ default: '精神科门诊' }) department: string;
  @Column({ type: 'text' }) reason: string;
  @Column({ type: 'varchar', default: 'draft' })
  status: 'draft' | 'submitted' | 'receipt_received' | 'closed';
  @Column() createdById: string;
  @Column({ type: 'varchar', nullable: true })
  outcome: 'accepted' | 'hospitalized' | 'outpatient' | 'declined' | null;
  @Column({ type: 'text', default: '' }) receiptText: string;   // 转介回执
  @Column({ type: 'timestamptz', nullable: true }) receiptAt: Date | null;
  @Column({ type: 'timestamptz', default: () => 'now()' }) createdAt: Date;

  @ManyToOne('Appointment') @JoinColumn({ name: 'appointment_id' }) appointment: Appointment;
}

// 危机事件（与普通咨询严格分流）
@Entity('crisis_events')
export class CrisisEvent {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid', nullable: true }) appointmentId: string | null;
  @Column({ type: 'uuid', nullable: true }) requestId: string | null;
  @Column() residentId: string;
  @Column({ type: 'uuid', nullable: true }) reporterId: string | null; // 系统自动识别时为空
  @Column({ type: 'varchar' }) level: SelfHarmRisk;
  @Column({ type: 'text' }) description: string;
  @Column({ type: 'text', default: '' }) actionTaken: string;
  @Column({ default: false }) escalatedToHospital: boolean;
  @Column({ type: 'uuid', nullable: true }) referralId: string | null;
  @Column({ type: 'varchar', default: 'open' }) status: 'open' | 'processing' | 'resolved';
  @Column({ type: 'timestamptz', nullable: true }) resolvedAt: Date | null;
  @Column({ type: 'timestamptz', default: () => 'now()' }) createdAt: Date;
}

// 随访
@Entity('follow_ups')
export class FollowUp {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() appointmentId: string;
  @Column() socialWorkerId: string;
  @Column({ type: 'varchar', default: 'phone' }) method: 'phone' | 'visit' | 'online';
  @Column({ type: 'text' }) content: string;
  @Column({ type: 'varchar', default: 'low' }) riskLevel: Urgency;
  @Column({ type: 'timestamptz', nullable: true }) nextFollowUpAt: Date | null;
  @Column({ type: 'timestamptz', default: () => 'now()' }) createdAt: Date;
}

// 服务评价
@Entity('service_ratings')
export class ServiceRating {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ unique: true }) appointmentId: string;
  @Column() residentId: string;
  @Column({ type: 'int' }) score: number;
  @Column({ type: 'text', default: '' }) comment: string;
  @Column({ type: 'timestamptz', default: () => 'now()' }) createdAt: Date;
}

// 家属查看记录申请（保密例外的审批链）
@Entity('family_access_requests')
export class FamilyAccessRequest {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() appointmentId: string;
  @Column() applicantName: string;
  @Column() relation: string;
  @Column({ default: '' }) contact: string;
  @Column({ type: 'text' }) reason: string;
  @Column({ type: 'varchar', default: 'pending' }) status: 'pending' | 'approved' | 'rejected';
  @Column({ type: 'uuid', nullable: true }) reviewedById: string | null;
  @Column({ type: 'text', default: '' }) reviewNote: string;
  @Column({ type: 'timestamptz', nullable: true }) approvedAt: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) expiresAt: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) viewedAt: Date | null; // 一次性授权：成功查看后写入，再次查看即拒绝
  @Column({ type: 'timestamptz', default: () => 'now()' }) createdAt: Date;
}

// 咨询师请假
@Entity('leave_requests')
export class LeaveRequest {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() counselorId: string;
  @Column({ type: 'date' }) startDate: string;
  @Column({ type: 'date' }) endDate: string;
  @Column({ type: 'text', default: '' }) reason: string;
  @Column({ type: 'varchar', default: 'pending' }) status: 'pending' | 'approved' | 'rejected';
  @Column({ type: 'uuid', nullable: true }) reviewedById: string | null;
  @Column({ type: 'timestamptz', default: () => 'now()' }) createdAt: Date;
}

// 服务链事件：把预约→初筛→咨询→危机→转介→随访串成一条时间线
@Entity('service_chain_events')
export class ServiceChainEvent {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid', nullable: true }) appointmentId: string | null;
  @Column({ type: 'uuid', nullable: true }) requestId: string | null;
  @Column({ type: 'uuid', nullable: true }) actorId: string | null;
  @Column() actorName: string;
  @Column() type: string;   // request/match/screening/record/crisis/referral/receipt/followup/rating/leave/no_show/...
  @Column({ type: 'text', default: '' }) detail: string;
  @Column({ default: false }) crisisRelated: boolean;
  @Column({ type: 'timestamptz', default: () => 'now()' }) createdAt: Date;

  @ManyToOne('Appointment', 'chainEvents') @JoinColumn({ name: 'appointment_id' })
  appointment: Appointment;
}
