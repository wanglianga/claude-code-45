import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import {
  User, CounselorProfile, AvailabilitySlot, BookingRequest, Appointment, Screening,
  ConsultationRecord, Referral, CrisisEvent, FollowUp, ServiceRating,
  FamilyAccessRequest, LeaveRequest, ServiceChainEvent, HighRiskTriage,
} from './entities';

function dateOffset(days: number): string {
  const d = new Date(); d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

@Injectable()
export class SeedService implements OnModuleInit {
  private readonly logger = new Logger('Seed');
  constructor(
    @InjectRepository(User) private users: Repository<User>,
    @InjectRepository(CounselorProfile) private profiles: Repository<CounselorProfile>,
    @InjectRepository(AvailabilitySlot) private slots: Repository<AvailabilitySlot>,
    @InjectRepository(BookingRequest) private requests: Repository<BookingRequest>,
    @InjectRepository(Appointment) private appointments: Repository<Appointment>,
    @InjectRepository(Screening) private screenings: Repository<Screening>,
    @InjectRepository(ConsultationRecord) private records: Repository<ConsultationRecord>,
    @InjectRepository(Referral) private referrals: Repository<Referral>,
    @InjectRepository(CrisisEvent) private crises: Repository<CrisisEvent>,
    @InjectRepository(FollowUp) private followUps: Repository<FollowUp>,
    @InjectRepository(ServiceRating) private ratings: Repository<ServiceRating>,
    @InjectRepository(FamilyAccessRequest) private family: Repository<FamilyAccessRequest>,
    @InjectRepository(LeaveRequest) private leaves: Repository<LeaveRequest>,
    @InjectRepository(ServiceChainEvent) private events: Repository<ServiceChainEvent>,
    @InjectRepository(HighRiskTriage) private triages: Repository<HighRiskTriage>,
  ) {}

  async onModuleInit() {
    const count = await this.users.count();
    if (count > 0) { this.logger.log('种子数据已存在，跳过'); return; }
    this.logger.log('写入演示种子数据...');
    const hash = (p: string) => bcrypt.hashSync(p, 10);

    const mkUser = async (username, password, realName, role, phone = '') =>
      this.users.save(this.users.create({
        username, passwordHash: hash(password), realName, role, phone,
      }));

    const admin = await mkUser('admin', 'admin123', '王主任', 'admin', '13800000001');
    const worker = await mkUser('worker', 'worker123', '李社工', 'social_worker', '13800000002');
    const zhang = await mkUser('zhang', 'zhang123', '张静', 'counselor', '13800000003');
    const chen = await mkUser('chen', 'chen123', '陈立', 'counselor', '13800000004');
    const min = await mkUser('min', 'min123', '王敏', 'resident', '13900000001');
    const lin = await mkUser('lin', 'lin123', '林浩', 'resident', '13900000002');

    await this.profiles.save([
      this.profiles.create({
        userId: zhang.id, title: '主任心理咨询师', crisisCertified: true, yearsExperience: 9,
        qualifications: '国家二级心理咨询师；危机干预认证（CISM）',
        specialties: ['抑郁焦虑', '危机干预', '情绪压力', '睡眠问题'],
        hospitalPartners: ['市精神卫生中心'],
      }),
      this.profiles.create({
        userId: chen.id, title: '心理咨询师', crisisCertified: false, yearsExperience: 4,
        qualifications: '国家三级心理咨询师；家庭治疗培训',
        specialties: ['婚姻家庭', '亲子教育', '职场人际'],
        hospitalPartners: [],
      }),
    ]);

    // 未来两周可约时段
    const slotRows: AvailabilitySlot[] = [];
    for (const cid of [zhang.id, chen.id]) {
      for (let d = 1; d <= 12; d++) {
        if (d % 3 === 0) continue;
        slotRows.push(this.slots.create({
          counselorId: cid, date: dateOffset(d), startTime: '09:00', endTime: '10:00',
        }));
        slotRows.push(this.slots.create({
          counselorId: cid, date: dateOffset(d), startTime: '14:00', endTime: '15:00',
        }));
      }
    }
    const savedSlots = await this.slots.save(slotRows);
    const slot = (cid: string, day: number, time: string) =>
      savedSlots.find(s => s.counselorId === cid && s.date === dateOffset(day) && s.startTime === time);

    const log = async (e: Partial<ServiceChainEvent>) => this.events.save(this.events.create(e));

    // ---------- 案例1：王敏 普通咨询，已走完整服务链 ----------
    const s1 = slot(chen.id, 1, '09:00');
    s1.status = 'booked'; await this.slots.save(s1);
    const req1 = await this.requests.save(this.requests.create({
      residentId: min.id, topicCategory: '婚姻家庭',
      topic: '婚后与公婆同住矛盾多，经常失眠、情绪低落，希望调整沟通方式',
      age: 34, urgency: 'medium', selfHarmRisk: 'none',
      priorCounseling: '2023年曾在区妇联做过2次婚姻家庭辅导',
      preferredTimes: [`${dateOffset(1)}T09:00`, `${dateOffset(2)}T14:00`],
      confidentialityAuthorized: true, crisisFlag: false, status: 'converted',
      matchedCounselorId: chen.id,
    }));
    const a1 = await this.appointments.save(this.appointments.create({
      requestId: req1.id, residentId: min.id, counselorId: chen.id,
      socialWorkerId: worker.id, slotId: s1.id,
      scheduledAt: new Date(`${dateOffset(1)}T09:00:00`),
      crisisLevel: 'low', status: 'completed', completedAt: new Date(),
    }));
    s1.appointmentId = a1.id; await this.slots.save(s1);

    await this.screenings.save(this.screenings.create({
      appointmentId: a1.id, socialWorkerId: worker.id,
      suitableCommunity: true, familyInvolved: true, familyMembers: ['配偶'],
      crisisLevel: 'low', decision: 'family_involved',
      riskAssessment: '情绪困扰为主，社会支持良好，无自伤风险',
      recommendation: '适合社区咨询，建议配偶参加首次访谈',
    }));
    const rec1 = await this.records.save(this.records.create({
      appointmentId: a1.id, counselorId: chen.id,
      topic: '家庭边界与情绪调节',
      content: '来访者倾诉与公婆在育儿方式上的冲突，多次哭泣。运用情绪聚焦与边界设置技术，探讨其与配偶的沟通模式，配偶在场时较回避。',
      riskAssessment: 'PHQ-9 自评 9 分（轻度），无自伤意念，睡眠差与情绪相关',
      riskLevel: 'low',
      interventionAdvice: '安排家庭作业：与配偶每周一次15分钟“非指责式沟通”；睡前呼吸放松训练；建议4次短程咨询',
      nextPlan: '两周后复诊，邀请配偶共同参加，评估家庭作业完成情况',
      nextAppointmentAt: new Date(`${dateOffset(15)}T09:00:00`),
    }));
    await this.followUps.save(this.followUps.create({
      appointmentId: a1.id, socialWorkerId: worker.id, method: 'phone',
      content: '咨询后第3天电话随访，情绪平稳，已与配偶尝试沟通，睡眠略有改善',
      riskLevel: 'low', nextFollowUpAt: new Date(`${dateOffset(10)}T10:00:00`),
    }));
    await this.ratings.save(this.ratings.create({
      appointmentId: a1.id, residentId: min.id, score: 5,
      comment: '陈老师很耐心，给了很多实用建议',
    }));
    await this.family.save(this.family.create({
      appointmentId: a1.id, applicantName: '王强', relation: '配偶', contact: '13900000003',
      reason: '希望了解如何配合帮助妻子改善情绪和睡眠', status: 'approved',
      reviewedById: admin.id, reviewNote: '本人知情同意，限72小时查看风险摘要',
      approvedAt: new Date(), expiresAt: new Date(Date.now() + 48 * 3600 * 1000),
    }));
    await log({ appointmentId: a1.id, requestId: req1.id, actorId: min.id, actorName: '王敏', type: 'request', detail: '提交预约申请：婚姻家庭｜紧急程度=medium｜自伤风险=none' });
    await log({ appointmentId: a1.id, actorName: '系统', type: 'match', detail: '智能匹配：陈立（擅长「婚姻家庭」；时段符合居民可约时间）' });
    await log({ appointmentId: a1.id, actorId: worker.id, actorName: '李社工', type: 'screening', detail: '初筛完成：需家属参与，适合社区咨询=true，风险=low' });
    await log({ appointmentId: a1.id, actorId: chen.id, actorName: '陈立', type: 'record', detail: `记录咨询过程：${rec1.topic}｜风险评级=low｜下次计划：两周后复诊` });
    await log({ appointmentId: a1.id, actorId: chen.id, actorName: '陈立', type: 'complete', detail: '咨询结束，进入随访与评价环节' });
    await log({ appointmentId: a1.id, actorId: worker.id, actorName: '李社工', type: 'followup', detail: '电话随访：情绪平稳，已与配偶尝试沟通，睡眠略有改善' });
    await log({ appointmentId: a1.id, actorId: min.id, actorName: '王敏', type: 'rating', detail: '服务评价：5星｜陈老师很耐心' });
    await log({ appointmentId: a1.id, actorId: admin.id, actorName: '王主任', type: 'family_review', detail: '批准家属 王强 在72小时内查看记录（保密例外，一次性授权）' });

    // ---------- 案例2：林浩 危机在途（待初筛） ----------
    const s2 = slot(zhang.id, 2, '14:00');
    s2.status = 'booked'; await this.slots.save(s2);
    const req2 = await this.requests.save(this.requests.create({
      residentId: lin.id, topicCategory: '危机干预',
      topic: '失业后持续两周失眠，有强烈消极念头，昨晚写了遗书，担心自己控制不住',
      age: 28, urgency: 'crisis', selfHarmRisk: 'plan',
      priorCounseling: '无', preferredTimes: [`${dateOffset(2)}T14:00`],
      confidentialityAuthorized: true, crisisFlag: true, status: 'matched',
      matchedCounselorId: zhang.id,
    }));
    const a2 = await this.appointments.save(this.appointments.create({
      requestId: req2.id, residentId: lin.id, counselorId: zhang.id,
      slotId: s2.id, scheduledAt: new Date(`${dateOffset(2)}T14:00:00`),
      crisisLevel: 'crisis', status: 'pending',
    }));
    s2.appointmentId = a2.id; await this.slots.save(s2);
    await log({ appointmentId: a2.id, requestId: req2.id, actorId: lin.id, actorName: '林浩', type: 'request', detail: '提交预约申请：危机干预｜紧急程度=crisis｜自伤风险=plan', crisisRelated: true });
    await log({ appointmentId: a2.id, actorName: '系统', type: 'crisis_flag', detail: '危机标记：进入危机优先通道，须由具危机干预资质的咨询师承接', crisisRelated: true });
    await log({ appointmentId: a2.id, actorName: '系统', type: 'match', detail: '智能匹配：张静（具危机干预资质；擅长「危机干预」）', crisisRelated: true });

    // ---------- 案例3：历史转介案例（已有医院回执），供供给统计 ----------
    const req3 = await this.requests.save(this.requests.create({
      residentId: lin.id, topicCategory: '抑郁焦虑',
      topic: '既往抑郁复发，出现幻觉与严重自伤计划，超出社区咨询范围',
      age: 28, urgency: 'crisis', selfHarmRisk: 'recent_act',
      priorCounseling: '曾在市精神卫生中心住院', preferredTimes: [],
      confidentialityAuthorized: true, crisisFlag: true, status: 'converted',
      matchedCounselorId: zhang.id,
    }));
    const a3 = await this.appointments.save(this.appointments.create({
      requestId: req3.id, residentId: lin.id, counselorId: zhang.id,
      socialWorkerId: worker.id,
      scheduledAt: new Date(`${dateOffset(-20)}T10:00:00`),
      crisisLevel: 'crisis', status: 'referred',
      statusReason: '初筛转介市精神卫生中心精神科门诊',
      completedAt: new Date(`${dateOffset(-19)}T00:00:00`),
    }));
    await this.referrals.save(this.referrals.create({
      appointmentId: a3.id, type: 'hospital_psychiatry',
      targetOrg: '市精神卫生中心', department: '精神科急诊',
      reason: '社工初筛：严重抑郁伴精神病性症状与近期自伤行为，须医学处置',
      status: 'receipt_received', outcome: 'hospitalized', createdById: worker.id,
      receiptText: '已收治住院，诊断中度抑郁发作伴精神病性症状，建议社区出院后接续随访',
      receiptAt: new Date(`${dateOffset(-18)}T00:00:00`),
    }));
    await this.crises.save(this.crises.create({
      appointmentId: a3.id, residentId: lin.id, reporterId: worker.id,
      level: 'recent_act', description: '近期发生自伤行为，家属求助',
      actionTaken: '社工与民警陪同送医；已收治住院', escalatedToHospital: true,
      status: 'resolved', resolvedAt: new Date(`${dateOffset(-18)}T00:00:00`),
    }));
    await log({ appointmentId: a3.id, requestId: req3.id, actorId: lin.id, actorName: '林浩', type: 'request', detail: '提交预约申请：抑郁焦虑｜紧急程度=crisis｜自伤风险=recent_act', crisisRelated: true });
    await log({ appointmentId: a3.id, actorId: worker.id, actorName: '李社工', type: 'screening', detail: '初筛完成：适合社区咨询=false，风险=crisis', crisisRelated: true });
    await log({ appointmentId: a3.id, actorId: worker.id, actorName: '李社工', type: 'referral', detail: '初筛转介 市精神卫生中心·精神科急诊', crisisRelated: true });
    await log({ appointmentId: a3.id, actorId: admin.id, actorName: '王主任', type: 'receipt', detail: '转介回执：结果=hospitalized｜已收治住院', crisisRelated: true });

    // ---------- 案例4：关键词触发的高危预约，待社工即时分流（未进入普通排班） ----------
    const req4 = await this.requests.save(this.requests.create({
      residentId: lin.id, topicCategory: '情绪压力',
      topic: '最近被裁员，每晚失眠，脑子里反复出现不想活了的念头，抽屉里放着安眠药，怕自己哪天撑不住吞药',
      age: 28, urgency: 'high', selfHarmRisk: 'ideation',
      priorCounseling: '无', preferredTimes: ['10:00'],
      confidentialityAuthorized: true, crisisFlag: true, status: 'triage',
      triageKeywords: ['不想活', '安眠药', '吞药'],
      emergencyContactName: '林建国', emergencyContactRelation: '父亲', emergencyContactPhone: '13500000001',
    }));
    await this.triages.save(this.triages.create({
      requestId: req4.id, residentId: lin.id,
      socialWorkerId: null, socialWorkerName: '',
      visitReason: req4.topic, riskLevel: 'high', status: 'in_progress',
      emergencyContactName: '林建国', emergencyContactRelation: '父亲', emergencyContactPhone: '13500000001',
      actionNote: '危机事件已自动开立，等待社工电话核实',
    }));
    await this.crises.save(this.crises.create({
      requestId: req4.id, residentId: lin.id, reporterId: null,
      level: 'ideation',
      description: `平台自动识别高危预约：${req4.topic}（命中关键词：不想活、安眠药、吞药）`,
      actionTaken: '待社工联系紧急联系人 林建国（父亲）13500000001',
      status: 'open',
    }));
    await log({ requestId: req4.id, actorId: lin.id, actorName: '林浩', type: 'request', detail: '提交预约申请：情绪压力｜紧急程度=high｜自伤风险=ideation｜紧急联系人=林建国(父亲)', crisisRelated: true });
    await log({ requestId: req4.id, actorName: '系统', type: 'crisis_flag', detail: '高危即时分流：文本命中自伤风险关键词（不想活、安眠药、吞药），跳过普通排班，转社工电话核实/联系紧急联系人/评估转介', crisisRelated: true });

    // ---------- 待审批：陈立请假（覆盖一个未来预约日，演示改约链） ----------
    await this.leaves.save(this.leaves.create({
      counselorId: chen.id, startDate: dateOffset(5), endDate: dateOffset(6),
      reason: '参加家庭治疗连续培训', status: 'pending',
    }));

    this.logger.log('种子数据写入完成');
  }
}
