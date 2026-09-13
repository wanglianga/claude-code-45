import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Controller, Get, Post, Body, Param, Query, UseGuards, BadRequestException, NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { In, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import {
  User, BookingRequest, Appointment, Screening, FollowUp, CrisisEvent,
  Referral, AvailabilitySlot, HighRiskTriage, ServiceChainEvent,
} from './entities';
import { AuthGuard, CurrentUser, JwtPayload, Roles } from './auth.guard';
import { ChainModule } from './chain.module';
import { ChainService } from './chain.service';
import { MatchModule } from './match.module';
import { MatchService } from './match.service';

// 统一以明确的 Asia/Shanghai (UTC+8) 渲染正文时间；结构化时间仍存 timestamptz
function fmtShanghai(d: Date | null | undefined, withSeconds = true): string {
  if (!d) return '';
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: withSeconds ? '2-digit' : undefined,
  }).formatToParts(d);
  const get = t => parts.find(p => p.type === t)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}${withSeconds ? ':' + get('second') : ''} (UTC+8)`;
}


class ScreeningDto {
  suitableCommunity: boolean;
  familyInvolved?: boolean;
  familyMembers?: string[];
  selfHarmConfirmed?: boolean;
  crisisLevel: 'low' | 'medium' | 'high' | 'crisis';
  riskAssessment?: string;
  decision: 'suitable' | 'family_involved' | 'refer_hospital';
  recommendation?: string;
}
class FollowUpDto {
  method?: 'phone' | 'visit' | 'online';
  content: string;
  riskLevel: 'low' | 'medium' | 'high' | 'crisis';
  nextFollowUpAt?: string | null;
}
class CrisisDto {
  appointmentId?: string | null;
  residentId?: string | null;
  residentName?: string;
  level: 'none' | 'ideation' | 'plan' | 'recent_act';
  description: string;
  actionTaken?: string;
  escalate?: boolean;
}

@Controller('worker')
@UseGuards(AuthGuard)
@Roles('social_worker', 'admin')
export class WorkerController {
  constructor(
    @InjectRepository(User) private users: Repository<User>,
    @InjectRepository(BookingRequest) private requests: Repository<BookingRequest>,
    @InjectRepository(Appointment) private appointments: Repository<Appointment>,
    @InjectRepository(Screening) private screenings: Repository<Screening>,
    @InjectRepository(FollowUp) private followUps: Repository<FollowUp>,
    @InjectRepository(CrisisEvent) private crises: Repository<CrisisEvent>,
    @InjectRepository(Referral) private referrals: Repository<Referral>,
    @InjectRepository(AvailabilitySlot) private slots: Repository<AvailabilitySlot>,
    @InjectRepository(HighRiskTriage) private triages: Repository<HighRiskTriage>,
    @InjectRepository(ServiceChainEvent) private chainEvents: Repository<ServiceChainEvent>,
    @InjectRepository(BookingRequest) private requestRepo: Repository<BookingRequest>,
    private chain: ChainService,
    private matcher: MatchService,
  ) {}

  @Get('residents')
  async residents(@Query('q') q?: string) {
    const all = await this.users.find({ where: { role: 'resident' } });
    return all
      .filter(u => !q || u.realName.includes(q) || u.username.includes(q) || (u.phone || '').includes(q))
      .map(u => ({ id: u.id, realName: u.realName, username: u.username, phone: u.phone, community: u.community }));
  }

  @Get('appointments')
  async listAppointments(@Query('status') status?: string, @Query('crisis') crisis?: string) {
    const where: any = {};
    if (status) where.status = status;
    let list = await this.appointments.find({
      where, order: { scheduledAt: 'ASC' },
      relations: ['resident', 'counselor', 'request'],
    });
    if (crisis === '1') list = list.filter(a => ['high', 'crisis'].includes(a.crisisLevel));
    return list.map(a => ({
      id: a.id, status: a.status, scheduledAt: a.scheduledAt, crisisLevel: a.crisisLevel,
      mode: a.mode, location: a.location, statusReason: a.statusReason,
      residentName: a.resident?.realName, residentPhone: a.resident?.phone,
      counselorName: a.counselor?.realName,
      topic: a.request?.topic, topicCategory: a.request?.topicCategory,
      selfHarmRisk: a.request?.selfHarmRisk, age: a.request?.age,
      preferredTimes: a.request?.preferredTimes, priorCounseling: a.request?.priorCounseling,
    }));
  }

  @Get('appointments/:id')
  async detail(@Param('id') id: string) {
    const a = await this.appointments.findOne({
      where: { id },
      relations: ['resident', 'counselor', 'request'],
    });
    if (!a) throw new NotFoundException();
    const [screening, followups, referrals, crisis, timeline, triage] = await Promise.all([
      this.screenings.findOne({ where: { appointmentId: id } }),
      this.followUps.find({ where: { appointmentId: id }, order: { createdAt: 'ASC' } }),
      this.referrals.find({ where: { appointmentId: id }, order: { createdAt: 'ASC' } }),
      this.crises.find({ where: { appointmentId: id } }),
      this.chain.timeline(id),
      a.requestId ? this.triages.findOne({ where: { requestId: a.requestId } }) : null,
    ]);
    return {
      appointment: a,
      request: a.request,
      resident: { id: a.resident.id, realName: a.resident.realName, phone: a.resident.phone },
      counselor: { id: a.counselor.id, realName: a.counselor.realName },
      screening, followups, referrals, crisis, timeline, triage,
    };
  }

  // 咨询前初筛：适合社区咨询 / 家属参与 / 直接转介医院
  @Post('appointments/:id/screening')
  async screen(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() dto: ScreeningDto) {
    const a = await this.requireAppointment(id);
    if (a.status !== 'pending') throw new BadRequestException('该预约已完成初筛');

    const exists = await this.screenings.findOne({ where: { appointmentId: id } });
    if (exists) throw new BadRequestException('初筛已存在');

    const screening = await this.screenings.save(this.screenings.create({
      appointmentId: id,
      socialWorkerId: u.sub,
      suitableCommunity: dto.suitableCommunity,
      familyInvolved: !!dto.familyInvolved,
      familyMembers: dto.familyMembers || [],
      selfHarmConfirmed: !!dto.selfHarmConfirmed,
      crisisLevel: dto.crisisLevel,
      riskAssessment: dto.riskAssessment || '',
      decision: dto.decision,
      recommendation: dto.recommendation || '',
    }));

    const crisisRelated = dto.decision === 'refer_hospital' || ['high', 'crisis'].includes(dto.crisisLevel);

    if (dto.decision === 'refer_hospital') {
      a.status = 'referred';
      a.statusReason = '初筛判定不适合社区咨询，直接转介精神专科';
      const referral = await this.referrals.save(this.referrals.create({
        appointmentId: id,
        type: 'hospital_psychiatry',
        reason: `社工初筛转介：${dto.riskAssessment || dto.recommendation || '风险超出社区咨询范围'}`,
        createdById: u.sub,
        status: 'submitted',
      }));
      await this.chain.log({
        appointmentId: id, actorId: u.sub, actorName: u.realName, type: 'referral',
        detail: `初筛转介 ${referral.targetOrg}·${referral.department}`, crisisRelated: true,
      });
    } else {
      a.status = 'confirmed';
      a.socialWorkerId = u.sub;
      if (dto.crisisLevel !== a.crisisLevel && ['high', 'crisis'].includes(dto.crisisLevel)) {
        a.crisisLevel = dto.crisisLevel;
      }
      await this.chain.log({
        appointmentId: id, actorId: u.sub, actorName: u.realName, type: 'screening',
        detail:
          `初筛完成：${dto.decision === 'family_involved' ? '需家属参与，' : ''}` +
          `适合社区咨询=${dto.suitableCommunity}，风险=${dto.crisisLevel}` +
          (dto.recommendation ? `｜${dto.recommendation}` : ''),
        crisisRelated,
      });
    }
    await this.appointments.save(a);
    return { ok: true, screening, status: a.status };
  }

  // 爽约登记 → 释放时段、进入随访链
  @Post('appointments/:id/no-show')
  async noShow(@CurrentUser() u: JwtPayload, @Param('id') id: string) {
    const a = await this.requireAppointment(id);
    if (['completed', 'no_show'].includes(a.status)) throw new BadRequestException('当前状态不可登记爽约');
    a.status = 'no_show';
    a.statusReason = '来访者爽约，社工将电话随访确认安全';
    await this.appointments.save(a);
    if (a.slotId) {
      const slot = await this.slots.findOne({ where: { id: a.slotId } });
      if (slot) { slot.status = 'available'; slot.appointmentId = null; await this.slots.save(slot); }
    }
    await this.chain.log({
      appointmentId: id, actorId: u.sub, actorName: u.realName, type: 'no_show',
      detail: '来访者爽约，时段已释放，安排电话随访',
      crisisRelated: ['high', 'crisis'].includes(a.crisisLevel),
    });
    return { ok: true };
  }

  // 咨询后随访（爽约后 / 转介后同样使用）
  @Post('appointments/:id/followup')
  async followUp(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() dto: FollowUpDto) {
    const a = await this.requireAppointment(id);
    if (!dto.content) throw new BadRequestException('随访内容必填');
    const f = await this.followUps.save(this.followUps.create({
      appointmentId: id, socialWorkerId: u.sub,
      method: dto.method || 'phone', content: dto.content,
      riskLevel: dto.riskLevel || 'low',
      nextFollowUpAt: dto.nextFollowUpAt ? new Date(dto.nextFollowUpAt) : null,
    }));
    const riskUp = ['high', 'crisis'].includes(dto.riskLevel) && !['high', 'crisis'].includes(a.crisisLevel);
    if (riskUp) {
      a.crisisLevel = dto.riskLevel;
      await this.appointments.save(a);
    }
    await this.chain.log({
      appointmentId: id, actorId: u.sub, actorName: u.realName, type: 'followup',
      detail: `${dto.method === 'phone' ? '电话' : dto.method === 'visit' ? '上门' : '线上'}随访：${dto.content}` +
        (dto.nextFollowUpAt ? `｜计划下次随访 ${dto.nextFollowUpAt.slice(0, 16)}` : ''),
      crisisRelated: ['high', 'crisis'].includes(dto.riskLevel),
    });
    if (riskUp) {
      await this.chain.log({
        appointmentId: id, actorName: '系统', type: 'risk_upgrade',
        detail: `随访发现风险升级为 ${dto.riskLevel}，触发危机处置流程`, crisisRelated: true,
      });
    }
    return { ok: true, followUp: f };
  }

  // ---------- 危机处置（与普通咨询分流） ----------
  @Get('crisis')
  async listCrisis(@Query('status') status?: string) {
    const where: any = {};
    if (status) where.status = status;
    return this.crises.find({
      where, order: { createdAt: 'DESC' },
    });
  }

  @Post('crisis')
  async createCrisis(@CurrentUser() u: JwtPayload, @Body() dto: CrisisDto) {
    let residentId = dto.residentId;
    let residentName = dto.residentName || '未登记居民';
    if (dto.appointmentId) {
      const a = await this.appointments.findOne({
        where: { id: dto.appointmentId }, relations: ['resident'],
      });
      if (a) { residentId = a.residentId; residentName = a.resident.realName; }
    } else if (residentId) {
      const r = await this.users.findOne({ where: { id: residentId } });
      if (r) residentName = r.realName;
    }
    if (!residentId) throw new BadRequestException('请指定居民或关联预约');
    if (!dto.description) throw new BadRequestException('请描述危机情况');

    const c = await this.crises.save(this.crises.create({
      appointmentId: dto.appointmentId || null,
      residentId, reporterId: u.sub,
      level: dto.level, description: dto.description,
      actionTaken: dto.actionTaken || '',
      escalatedToHospital: !!dto.escalate,
      status: dto.escalate ? 'processing' : 'open',
    }));

    if (dto.appointmentId) {
      const a = await this.appointments.findOne({ where: { id: dto.appointmentId } });
      if (a && !['high', 'crisis'].includes(a.crisisLevel)) {
        a.crisisLevel = 'crisis'; await this.appointments.save(a);
      }
      await this.chain.log({
        appointmentId: dto.appointmentId, actorId: u.sub, actorName: u.realName,
        type: 'crisis', detail: `登记危机事件（${dto.level}）：${dto.description}`, crisisRelated: true,
      });
    }
    return { ok: true, crisis: c };
  }

  @Post('crisis/:id/process')
  async processCrisis(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() body: { actionTaken?: string }) {
    const c = await this.crises.findOne({ where: { id } });
    if (!c) throw new NotFoundException();
    c.status = 'processing';
    if (body.actionTaken) c.actionTaken = (c.actionTaken ? c.actionTaken + '\n' : '') + body.actionTaken;
    await this.crises.save(c);
    if (c.appointmentId) {
      await this.chain.log({
        appointmentId: c.appointmentId, actorId: u.sub, actorName: u.realName,
        type: 'crisis_process', detail: `危机处置中：${body.actionTaken || '已启动多部门响应'}`,
        crisisRelated: true,
      });
    }
    return { ok: true };
  }

  @Post('crisis/:id/resolve')
  async resolveCrisis(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() body: { note?: string }) {
    const c = await this.crises.findOne({ where: { id } });
    if (!c) throw new NotFoundException();
    c.status = 'resolved';
    c.resolvedAt = new Date();
    if (body.note) c.actionTaken = (c.actionTaken ? c.actionTaken + '\n' : '') + `结案：${body.note}`;
    await this.crises.save(c);
    if (c.appointmentId) {
      await this.chain.log({
        appointmentId: c.appointmentId, actorId: u.sub, actorName: u.realName,
        type: 'crisis_resolve', detail: `危机事件结案：${body.note || '风险解除'}`, crisisRelated: true,
      });
    }
    return { ok: true };
  }

  // ================= 高危预约即时分流 =================
  @Get('triage')
  async listTriage(@Query('status') status?: string) {
    const where: any = {};
    if (status) where.status = status;
    const list = await this.triages.find({ where, order: { createdAt: 'ASC' } });
    const result = [];
    for (const t of list) {
      const req = await this.requestRepo.findOne({ where: { id: t.requestId }, relations: ['resident'] });
      if (!req) continue;
      result.push({
        ...t,
        urgency: req.urgency,
        selfHarmRisk: req.selfHarmRisk,
        topicCategory: req.topicCategory,
        topic: req.topic,
        keywords: req.triageKeywords || [],
        age: req.age,
        residentName: req.resident?.realName,
        residentPhone: req.resident?.phone,
        preferredTimes: req.preferredTimes,
        requestCreatedAt: req.createdAt,
      });
    }
    return result;
  }

  @Get('triage/:id')
  async triageDetail(@Param('id') id: string) {
    const t = await this.triages.findOne({ where: { id } });
    if (!t) throw new NotFoundException('分诊单不存在');
    const req = await this.requestRepo.findOne({ where: { id: t.requestId }, relations: ['resident'] });
    const chainWhere: any[] = [];
    if (t.requestId) chainWhere.push({ requestId: t.requestId });
    if (t.appointmentId) chainWhere.push({ appointmentId: t.appointmentId });
    return {
      triage: t,
      request: req,
      resident: req && { id: req.resident?.id, realName: req.resident?.realName, phone: req.resident?.phone },
      timeline: chainWhere.length
        ? await this.chainEvents.find({ where: chainWhere, order: { createdAt: 'ASC' } })
        : [],
    };
  }

  // 社工电话核实：来访原因、量表结果、紧急联系人、风险等级；记录响应时间
  @Post('triage/:id/verify')
  async verifyTriage(
    @CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() dto: {
      visitReason: string;
      scaleResult?: string;
      scaleScore?: number | null;
      emergencyContactName?: string;
      emergencyContactRelation?: string;
      emergencyContactPhone?: string;
      riskLevel?: 'low' | 'medium' | 'high' | 'crisis';
      note?: string;
    },
  ) {
    const t = await this.requireTriage(id);
    if (t.status !== 'in_progress') {
      throw new ConflictException(`分诊单当前状态为「${t.status}」，已结束的分诊不能再电话核实`);
    }
    if (!dto.visitReason) throw new BadRequestException('请记录来访原因（电话核实情况）');
    t.socialWorkerId = u.sub;
    t.socialWorkerName = u.realName;
    t.visitReason = dto.visitReason;
    t.scaleResult = dto.scaleResult || '';
    t.scaleScore = dto.scaleScore ?? null;
    if (dto.emergencyContactName) t.emergencyContactName = dto.emergencyContactName;
    if (dto.emergencyContactRelation) t.emergencyContactRelation = dto.emergencyContactRelation;
    if (dto.emergencyContactPhone) t.emergencyContactPhone = dto.emergencyContactPhone;
    if (dto.riskLevel) t.riskLevel = dto.riskLevel;
    if (dto.note) t.actionNote = (t.actionNote ? t.actionNote + '\n' : '') + dto.note;
    if (!t.respondedAt) t.respondedAt = new Date();
    await this.triages.save(t);

    // 同步自动开立的危机事件，标记社工已响应
    const ce = await this.crises.findOne({ where: { requestId: t.requestId, status: 'open' } });
    if (ce) {
      ce.reporterId = u.sub;
      ce.status = 'processing';
      ce.actionTaken = (ce.actionTaken ? ce.actionTaken + '\n' : '') +
        `${u.realName} 电话核实（${fmtShanghai(t.respondedAt)}）：${dto.visitReason}` +
        (dto.scaleResult ? `｜量表：${dto.scaleResult}${dto.scaleScore != null ? '=' + dto.scaleScore : ''}` : '');
      await this.crises.save(ce);
    }

    await this.chain.log({
      requestId: t.requestId, actorId: u.sub, actorName: u.realName, type: 'triage_verify',
      detail: `社工电话核实完成，响应时间=${fmtShanghai(t.respondedAt)}｜来访原因：${dto.visitReason}` +
        (dto.scaleResult ? `｜量表结果：${dto.scaleResult}${dto.scaleScore != null ? '（' + dto.scaleScore + '分）' : ''}` : '') +
        (t.emergencyContactName ? `｜紧急联系人：${t.emergencyContactName}（${t.emergencyContactRelation}）${t.emergencyContactPhone}` : '') +
        `｜风险等级=${t.riskLevel}`,
      crisisRelated: true,
    });
    return { ok: true, respondedAt: t.respondedAt };
  }

  // 联系紧急联系人：响应写入危机记录
  @Post('triage/:id/emergency-contact')
  async contactEmergency(
    @CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() dto: {
      reached: boolean;
      response: string;
      contactName?: string;
      relation?: string;
      phone?: string;
    },
  ) {
    const t = await this.requireTriage(id);
    if (t.status !== 'in_progress') {
      throw new ConflictException(`分诊单当前状态为「${t.status}」，已结束的分诊不能再联系紧急联系人`);
    }
    if (!dto.response) throw new BadRequestException('请记录紧急联系人响应情况');
    if (!t.socialWorkerId) { t.socialWorkerId = u.sub; t.socialWorkerName = u.realName; t.respondedAt = new Date(); }
    t.emergencyContactReached = !!dto.reached;
    t.emergencyContactResponse = dto.response;
    t.emergencyContactRespondedAt = new Date();
    if (dto.contactName) t.emergencyContactName = dto.contactName;
    if (dto.relation) t.emergencyContactRelation = dto.relation;
    if (dto.phone) t.emergencyContactPhone = dto.phone;
    await this.triages.save(t);

    // 紧急联系人响应进入危机记录
    const ce = (await this.crises.findOne({ where: { requestId: t.requestId } }))
      || await this.crises.save(this.crises.create({
        requestId: t.requestId, residentId: t.residentId, reporterId: u.sub,
        level: t.riskLevel === 'crisis' ? 'plan' : 'ideation',
        description: '高危分诊联系紧急联系人', status: 'processing',
      }));
    ce.actionTaken = (ce.actionTaken ? ce.actionTaken + '\n' : '') +
      `${u.realName} 联系紧急联系人 ${t.emergencyContactName}（${t.emergencyContactRelation}）${t.emergencyContactPhone}：` +
      `${dto.reached ? '已联系上' : '未能联系上'}，响应：${dto.response}（${fmtShanghai(t.emergencyContactRespondedAt)}）`;
    if (ce.status === 'open') { ce.status = 'processing'; ce.reporterId = u.sub; }
    await this.crises.save(ce);

    await this.chain.log({
      requestId: t.requestId, actorId: u.sub, actorName: u.realName, type: 'emergency_contact',
      detail: `联系紧急联系人 ${t.emergencyContactName}（${t.emergencyContactRelation}）：${dto.reached ? '已响应' : '未联系上'}｜${dto.response}｜响应时间=${fmtShanghai(t.emergencyContactRespondedAt)}`,
      crisisRelated: true,
    });
    return { ok: true, crisisEventId: ce.id };
  }

  // 分诊转介医院（尚未生成预约阶段）；回执由管理者补录
  @Post('triage/:id/refer')
  async referFromTriage(
    @CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() dto: {
      targetOrg?: string;
      department?: string;
      reason: string;
    },
  ) {
    const t = await this.requireTriage(id);
    if (t.status === 'referred' || t.status === 'closed') {
      throw new ConflictException('该个案已转介医院且转介结果不可撤销，不能重复转介或改为社区接单');
    }
    if (t.status === 'admitted_community') {
      throw new ConflictException('该个案已转入社区咨询，不能再转介医院');
    }
    if (!dto.reason) throw new BadRequestException('请填写转介原因');
    const referral = await this.referrals.save(this.referrals.create({
      requestId: t.requestId, appointmentId: null,
      targetOrg: dto.targetOrg || '市精神卫生中心',
      department: dto.department || '精神科急诊',
      reason: dto.reason, createdById: u.sub, status: 'submitted',
    }));
    t.status = 'referred';
    t.referralId = referral.id;
    t.completedAt = new Date();
    await this.triages.save(t);
    const req = await this.requestRepo.findOne({ where: { id: t.requestId } });
    if (req) { req.status = 'crisis_handled'; await this.requestRepo.save(req); }

    const ce = await this.crises.findOne({ where: { requestId: t.requestId } });
    if (ce) {
      ce.escalatedToHospital = true;
      ce.actionTaken = (ce.actionTaken ? ce.actionTaken + '\n' : '') +
        `${u.realName} 转介 ${referral.targetOrg}·${referral.department}，等待医院回执`;
      ce.status = 'processing';
      await this.crises.save(ce);
    }
    await this.chain.log({
      requestId: t.requestId, actorId: u.sub, actorName: u.realName, type: 'referral',
      detail: `高危分流转介 ${referral.targetOrg}·${referral.department}：${dto.reason}（转介结果待回执）`,
      crisisRelated: true,
    });
    return { ok: true, referralId: referral.id };
  }

  // 经核实风险可控 → 转入社区咨询：生成预约（危机资质咨询师），分诊闭环
  @Post('triage/:id/admit-community')
  async admitCommunity(
    @CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() dto: { note?: string },
  ) {
    const t = await this.requireTriage(id);
    if (t.status === 'referred' || t.status === 'closed') {
      throw new ConflictException('医院回执后的转介结果不可被社区接单覆盖');
    }
    if (t.status === 'admitted_community') {
      throw new ConflictException('该个案已转入社区咨询，不能重复接单');
    }
    if (!t.visitReason) throw new BadRequestException('请先完成电话核实再转入社区咨询');
    const req = await this.requestRepo.findOne({ where: { id: t.requestId } });
    if (!req) throw new NotFoundException('申请不存在');
    const ranked = await this.matcher.rankCandidates(req);
    const best = ranked[0];
    if (!best?.slot) {
      throw new BadRequestException('暂无可承接的危机资质咨询师空档，请走转介医院或联系管理员排班');
    }
    const appt = await this.appointments.save(this.appointments.create({
      requestId: req.id, residentId: req.residentId,
      counselorId: best.counselorId, slotId: best.slot.id,
      scheduledAt: new Date(`${best.slot.date}T${best.slot.startTime}:00`),
      crisisLevel: req.urgency === 'crisis' ? 'crisis' : 'high',
      status: 'pending',
      statusReason: `高危分流后转入社区咨询（社工 ${u.realName} 电话核实）`,
    }));
    best.slot.status = 'booked'; best.slot.appointmentId = appt.id;
    await this.slots.save(best.slot);

    t.status = 'admitted_community';
    t.appointmentId = appt.id;
    t.completedAt = new Date();
    if (dto?.note) t.actionNote = (t.actionNote ? t.actionNote + '\n' : '') + dto.note;
    await this.triages.save(t);
    req.status = 'matched'; req.matchedCounselorId = best.counselorId;
    await this.requestRepo.save(req);

    const ce = await this.crises.findOne({ where: { requestId: t.requestId } });
    if (ce) {
      ce.appointmentId = appt.id;
      ce.actionTaken = (ce.actionTaken ? ce.actionTaken + '\n' : '') +
        `经电话核实风险可控，转入社区咨询：${best.name}（${best.slotLabel}）`;
      await this.crises.save(ce);
    }
    await this.chain.log({
      requestId: req.id, appointmentId: appt.id, actorId: u.sub, actorName: u.realName,
      type: 'triage_admit', crisisRelated: true,
      detail: `高危分流结束：风险可控转入社区咨询，匹配 ${best.name}（${best.slotLabel}），咨询师接单前可查看分诊风险画像`,
    });
    return { ok: true, appointmentId: appt.id };
  }

  private async requireTriage(id: string) {
    const t = await this.triages.findOne({ where: { id } });
    if (!t) throw new NotFoundException('分诊单不存在');
    return t;
  }

  private async requireAppointment(id: string) {
    const a = await this.appointments.findOne({ where: { id } });
    if (!a) throw new NotFoundException('预约不存在');
    return a;
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([
    User, BookingRequest, Appointment, Screening, FollowUp, CrisisEvent, Referral, AvailabilitySlot,
    HighRiskTriage, ServiceChainEvent,
  ]), ChainModule, MatchModule],
  controllers: [WorkerController],
})
export class WorkerModule {}
