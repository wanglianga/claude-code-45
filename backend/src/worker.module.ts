import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Controller, Get, Post, Body, Param, Query, UseGuards, BadRequestException, NotFoundException,
} from '@nestjs/common';
import { In, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import {
  User, BookingRequest, Appointment, Screening, FollowUp, CrisisEvent,
  Referral, AvailabilitySlot,
} from './entities';
import { AuthGuard, CurrentUser, JwtPayload, Roles } from './auth.guard';
import { ChainModule } from './chain.module';
import { ChainService } from './chain.service';

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
    private chain: ChainService,
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
    const [screening, followups, referrals, crisis, timeline] = await Promise.all([
      this.screenings.findOne({ where: { appointmentId: id } }),
      this.followUps.find({ where: { appointmentId: id }, order: { createdAt: 'ASC' } }),
      this.referrals.find({ where: { appointmentId: id }, order: { createdAt: 'ASC' } }),
      this.crises.find({ where: { appointmentId: id } }),
      this.chain.timeline(id),
    ]);
    return {
      appointment: a,
      request: a.request,
      resident: { id: a.resident.id, realName: a.resident.realName, phone: a.resident.phone },
      counselor: { id: a.counselor.id, realName: a.counselor.realName },
      screening, followups, referrals, crisis, timeline,
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

  private async requireAppointment(id: string) {
    const a = await this.appointments.findOne({ where: { id } });
    if (!a) throw new NotFoundException('预约不存在');
    return a;
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([
    User, BookingRequest, Appointment, Screening, FollowUp, CrisisEvent, Referral, AvailabilitySlot,
  ]), ChainModule],
  controllers: [WorkerController],
})
export class WorkerModule {}
