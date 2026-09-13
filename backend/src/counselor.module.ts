import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Controller, Get, Post, Body, Param, Query, UseGuards, BadRequestException, NotFoundException,
} from '@nestjs/common';
import { Between, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import {
  User, CounselorProfile, AvailabilitySlot, Appointment, Screening,
  ConsultationRecord, Referral, FamilyAccessRequest, FollowUp, CrisisEvent, LeaveRequest,
  HighRiskTriage,
} from './entities';
import { AuthGuard, CurrentUser, JwtPayload, Roles } from './auth.guard';
import { ChainModule } from './chain.module';
import { ChainService } from './chain.service';

class SlotDto { date: string; startTime: string; endTime: string; }
class RecordDto {
  topic: string;
  content: string;
  riskAssessment?: string;
  riskLevel?: 'low' | 'medium' | 'high' | 'crisis';
  interventionAdvice: string;
  nextPlan?: string;
  nextAppointmentAt?: string | null;
  confidential?: boolean;
}
class ReferralDto {
  type?: 'hospital_psychiatry' | 'community_internal' | 'crisis_hotline';
  targetOrg?: string;
  department?: string;
  reason: string;
}
class LeaveDto { startDate: string; endDate: string; reason?: string; }

@Controller('counselor')
@UseGuards(AuthGuard)
@Roles('counselor')
export class CounselorController {
  constructor(
    @InjectRepository(User) private users: Repository<User>,
    @InjectRepository(CounselorProfile) private profiles: Repository<CounselorProfile>,
    @InjectRepository(AvailabilitySlot) private slots: Repository<AvailabilitySlot>,
    @InjectRepository(Appointment) private appointments: Repository<Appointment>,
    @InjectRepository(Screening) private screenings: Repository<Screening>,
    @InjectRepository(ConsultationRecord) private records: Repository<ConsultationRecord>,
    @InjectRepository(Referral) private referrals: Repository<Referral>,
    @InjectRepository(FamilyAccessRequest) private family: Repository<FamilyAccessRequest>,
    @InjectRepository(FollowUp) private followUps: Repository<FollowUp>,
    @InjectRepository(CrisisEvent) private crises: Repository<CrisisEvent>,
    @InjectRepository(LeaveRequest) private leaves: Repository<LeaveRequest>,
    @InjectRepository(HighRiskTriage) private triages: Repository<HighRiskTriage>,
    private chain: ChainService,
  ) {}

  @Get('profile')
  async profile(@CurrentUser() u: JwtPayload) {
    const user = await this.users.findOne({ where: { id: u.sub }, relations: ['counselorProfile'] });
    return user?.counselorProfile || null;
  }

  // ---------- 可约时段 ----------
  @Get('slots')
  async listSlots(@CurrentUser() u: JwtPayload, @Query('from') from?: string, @Query('to') to?: string) {
    const where: any = { counselorId: u.sub };
    if (from && to) where.date = Between(from, to);
    return this.slots.find({ where, order: { date: 'ASC', startTime: 'ASC' } });
  }

  @Post('slots')
  async addSlot(@CurrentUser() u: JwtPayload, @Body() dto: SlotDto) {
    if (!dto.date || !dto.startTime || !dto.endTime) throw new BadRequestException('日期与起止时间必填');
    const overlap = await this.slots.findOne({
      where: { counselorId: u.sub, date: dto.date, status: 'available' },
    });
    if (overlap && !(dto.endTime <= overlap.startTime || dto.startTime >= overlap.endTime)) {
      throw new BadRequestException('与已有可用时段冲突');
    }
    const s = await this.slots.save(this.slots.create({
      counselorId: u.sub, date: dto.date, startTime: dto.startTime, endTime: dto.endTime,
    }));
    return { ok: true, slot: s };
  }

  @Post('slots/:id/remove')
  async removeSlot(@CurrentUser() u: JwtPayload, @Param('id') id: string) {
    const s = await this.slots.findOne({ where: { id } });
    if (!s || s.counselorId !== u.sub) throw new NotFoundException();
    if (s.status === 'booked') throw new BadRequestException('该时段已有预约，不可删除（请走请假/改约流程）');
    await this.slots.remove(s);
    return { ok: true };
  }

  // ---------- 请假 ----------
  @Post('leave')
  async requestLeave(@CurrentUser() u: JwtPayload, @Body() dto: LeaveDto) {
    if (!dto.startDate || !dto.endDate) throw new BadRequestException('请假起止日期必填');
    const leave = await this.leaves.save(this.leaves.create({
      counselorId: u.sub, startDate: dto.startDate, endDate: dto.endDate, reason: dto.reason || '',
    }));
    return { ok: true, id: leave.id };
  }

  @Get('leave')
  listLeave(@CurrentUser() u: JwtPayload) {
    return this.leaves.find({ where: { counselorId: u.sub }, order: { createdAt: 'DESC' } });
  }

  // ---------- 我的咨询 ----------
  @Get('appointments')
  async listAppointments(@CurrentUser() u: JwtPayload, @Query('status') status?: string) {
    const where: any = { counselorId: u.sub };
    if (status) where.status = status;
    const list = await this.appointments.find({
      where, order: { scheduledAt: 'ASC' },
      relations: ['resident', 'request'],
    });
    return list.map(a => ({
      id: a.id, status: a.status, scheduledAt: a.scheduledAt, crisisLevel: a.crisisLevel,
      mode: a.mode, location: a.location, statusReason: a.statusReason,
      residentName: a.resident?.realName, residentPhone: a.resident?.phone,
      topic: a.request?.topic, topicCategory: a.request?.topicCategory,
      selfHarmRisk: a.request?.selfHarmRisk, age: a.request?.age,
      priorCounseling: a.request?.priorCounseling,
    }));
  }

  @Get('appointments/:id')
  async detail(@CurrentUser() u: JwtPayload, @Param('id') id: string) {
    const a = await this.appointments.findOne({
      where: { id }, relations: ['resident', 'request'],
    });
    if (!a) throw new NotFoundException();
    if (a.counselorId !== u.sub) throw new BadRequestException('仅承接咨询师可查看本单完整记录');
    const refWhere: any[] = [{ appointmentId: id }];
    if (a.requestId) refWhere.push({ requestId: a.requestId });
    const crisisWhere: any[] = [{ appointmentId: id }];
    if (a.requestId) crisisWhere.push({ requestId: a.requestId });
    const [screening, records, referrals, followups, crises, familyReqs, timeline, triage] = await Promise.all([
      this.screenings.findOne({ where: { appointmentId: id } }),
      this.records.find({ where: { appointmentId: id }, order: { createdAt: 'ASC' } }),
      this.referrals.find({ where: refWhere, order: { createdAt: 'ASC' } }),
      this.followUps.find({ where: { appointmentId: id }, order: { createdAt: 'ASC' } }),
      this.crises.find({ where: crisisWhere }),
      this.family.find({ where: { appointmentId: id }, order: { createdAt: 'DESC' } }),
      this.chain.timelineFor(a.requestId, id),
      a.requestId ? this.triages.findOne({ where: { requestId: a.requestId } }) : null,
    ]);
    return {
      appointment: a, request: a.request,
      resident: { id: a.resident.id, realName: a.resident.realName, phone: a.resident.phone, age: a.request?.age },
      screening, records, referrals, followups, crises, triage,
      familyRequests: familyReqs, timeline,
    };
  }

  // 咨询记录：主题/风险评估/干预建议/下次计划（仅承接咨询师与危机督导可见）
  @Post('appointments/:id/records')
  async addRecord(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() dto: RecordDto) {
    const a = await this.requireOwnedAppointment(u, id);
    if (!['confirmed', 'in_progress'].includes(a.status)) {
      throw new BadRequestException('仅初筛通过的预约可记录咨询过程');
    }
    if (!dto.topic || !dto.content || !dto.interventionAdvice) {
      throw new BadRequestException('主题、咨询过程、干预建议必填');
    }
    const risk = dto.riskLevel || 'low';
    const r = await this.records.save(this.records.create({
      appointmentId: id, counselorId: u.sub,
      topic: dto.topic, content: dto.content,
      riskAssessment: dto.riskAssessment || '', riskLevel: risk,
      interventionAdvice: dto.interventionAdvice,
      nextPlan: dto.nextPlan || '',
      nextAppointmentAt: dto.nextAppointmentAt ? new Date(dto.nextAppointmentAt) : null,
      confidential: dto.confidential !== false,
    }));
    if (a.status === 'confirmed') { a.status = 'in_progress'; }
    // 风险升级 → 危机标记联动
    const escalate = ['high', 'crisis'].includes(risk) && !['high', 'crisis'].includes(a.crisisLevel);
    if (escalate) a.crisisLevel = risk;
    await this.appointments.save(a);

    await this.chain.log({
      appointmentId: id, actorId: u.sub, actorName: u.realName, type: 'record',
      detail: `记录咨询过程：${dto.topic}｜风险评级=${risk}` +
        (dto.nextPlan ? `｜下次计划：${dto.nextPlan}` : ''),
      crisisRelated: escalate || ['high', 'crisis'].includes(risk),
    });
    if (escalate) {
      await this.crises.save(this.crises.create({
        appointmentId: id, residentId: a.residentId, reporterId: u.sub,
        level: risk === 'crisis' ? 'plan' : 'ideation',
        description: `咨询记录风险升级（${risk}）：${dto.riskAssessment || dto.topic}`,
        actionTaken: '已通知社工与社区危机响应',
        status: 'open',
      }));
      await this.chain.log({
        appointmentId: id, actorName: '系统', type: 'risk_upgrade',
        detail: '咨询中风险升级，自动开立危机事件并通知社工', crisisRelated: true,
      });
    }
    return { ok: true, record: r };
  }

  @Post('appointments/:id/complete')
  async complete(@CurrentUser() u: JwtPayload, @Param('id') id: string) {
    const a = await this.requireOwnedAppointment(u, id);
    const recordCount = await this.records.count({ where: { appointmentId: id } });
    if (!recordCount) throw new BadRequestException('请先填写咨询记录再结束咨询');
    a.status = 'completed'; a.completedAt = new Date();
    await this.appointments.save(a);
    await this.chain.log({
      appointmentId: id, actorId: u.sub, actorName: u.realName, type: 'complete',
      detail: '咨询结束，进入随访与评价环节',
      crisisRelated: ['high', 'crisis'].includes(a.crisisLevel),
    });
    return { ok: true };
  }

  // 转介精神专科
  @Post('appointments/:id/referral')
  async refer(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() dto: ReferralDto) {
    const a = await this.requireOwnedAppointment(u, id);
    if (!dto.reason) throw new BadRequestException('转介原因必填');
    const r = await this.referrals.save(this.referrals.create({
      appointmentId: id,
      type: dto.type || 'hospital_psychiatry',
      targetOrg: dto.targetOrg || '市精神卫生中心',
      department: dto.department || '精神科门诊',
      reason: dto.reason, createdById: u.sub, status: 'submitted',
    }));
    a.status = 'referred';
    a.statusReason = `咨询师转介至${r.targetOrg}${r.department}`;
    await this.appointments.save(a);
    await this.chain.log({
      appointmentId: id, actorId: u.sub, actorName: u.realName, type: 'referral',
      detail: `转介 ${r.targetOrg}·${r.department}：${dto.reason}`, crisisRelated: true,
    });
    return { ok: true, referral: r };
  }

  private async requireOwnedAppointment(u: JwtPayload, id: string) {
    const a = await this.appointments.findOne({ where: { id } });
    if (!a) throw new NotFoundException('预约不存在');
    if (a.counselorId !== u.sub) throw new BadRequestException('仅承接咨询师可操作本单');
    return a;
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([
    User, CounselorProfile, AvailabilitySlot, Appointment, Screening,
    ConsultationRecord, Referral, FamilyAccessRequest, FollowUp, CrisisEvent, LeaveRequest,
    HighRiskTriage,
  ]), ChainModule],
  controllers: [CounselorController],
})
export class CounselorModule {}
