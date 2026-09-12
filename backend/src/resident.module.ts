import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Controller, Get, Post, Body, Param, Query, UseGuards, BadRequestException, NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, MoreThan } from 'typeorm';
import {
  User, CounselorProfile, AvailabilitySlot, BookingRequest, Appointment,
  ConsultationRecord, ServiceRating, FamilyAccessRequest, ServiceChainEvent,
} from './entities';
import { AuthGuard, CurrentUser, JwtPayload, Roles } from './auth.guard';
import { ChainModule } from './chain.module';
import { ChainService } from './chain.service';

const CRISIS_URGENCIES = ['high', 'crisis'];

class CreateRequestDto {
  topicCategory: string;
  topic: string;
  age: number;
  urgency: 'low' | 'medium' | 'high' | 'crisis';
  selfHarmRisk: 'none' | 'ideation' | 'plan' | 'recent_act';
  priorCounseling?: string;
  preferredTimes?: string[];
  confidentialityAuthorized: boolean;
}

class RatingDto { score: number; comment?: string; }
class FamilyAccessDto { applicantName: string; relation: string; contact?: string; reason: string; }

@Controller('resident')
@UseGuards(AuthGuard)
export class ResidentController {
  constructor(
    @InjectRepository(User) private users: Repository<User>,
    @InjectRepository(CounselorProfile) private profiles: Repository<CounselorProfile>,
    @InjectRepository(AvailabilitySlot) private slots: Repository<AvailabilitySlot>,
    @InjectRepository(BookingRequest) private requests: Repository<BookingRequest>,
    @InjectRepository(Appointment) private appointments: Repository<Appointment>,
    @InjectRepository(ConsultationRecord) private records: Repository<ConsultationRecord>,
    @InjectRepository(ServiceRating) private ratings: Repository<ServiceRating>,
    @InjectRepository(FamilyAccessRequest) private family: Repository<FamilyAccessRequest>,
    private chain: ChainService,
  ) {}

  // ---------- 预约申请 ----------
  @Post('requests')
  @Roles('resident')
  async createRequest(@CurrentUser() u: JwtPayload, @Body() dto: CreateRequestDto) {
    if (!dto.confidentialityAuthorized) {
      throw new BadRequestException('需先签署保密授权才能提交预约');
    }
    if (!dto.topic || dto.age == null) throw new BadRequestException('主题与年龄必填');
    const crisis =
      CRISIS_URGENCIES.includes(dto.urgency) ||
      ['plan', 'recent_act'].includes(dto.selfHarmRisk);
    const req = await this.requests.save(this.requests.create({
      residentId: u.sub,
      topicCategory: dto.topicCategory,
      topic: dto.topic,
      age: dto.age,
      urgency: dto.urgency,
      selfHarmRisk: dto.selfHarmRisk,
      priorCounseling: dto.priorCounseling || '',
      preferredTimes: dto.preferredTimes || [],
      confidentialityAuthorized: true,
      crisisFlag: crisis,
    }));
    await this.chain.log({
      requestId: req.id, actorId: u.sub, actorName: u.realName,
      type: 'request',
      detail: `提交预约申请：${dto.topicCategory}｜紧急程度=${dto.urgency}｜自伤风险=${dto.selfHarmRisk}`,
      crisisRelated: crisis,
    });
    if (crisis) {
      await this.chain.log({
        requestId: req.id, actorName: '系统', type: 'crisis_flag',
        detail: '危机标记：申请进入危机优先通道，须由具危机干预资质的咨询师承接',
        crisisRelated: true,
      });
    }
    return { ok: true, request: await this.getRequestDetail(req.id, u) };
  }

  @Get('requests')
  async listRequests(@CurrentUser() u: JwtPayload, @Query('scope') scope?: string) {
    // scope=all 是社区监管视角，仅管理员可用；社工/咨询师不得借此读取全部居民申请
    if (scope === 'all' && u.role !== 'admin') {
      throw new ForbiddenException('仅社区管理者可查看全量申请');
    }
    const where: any = {};
    if (!(u.role === 'admin' && scope === 'all')) where.residentId = u.sub;
    const list = await this.requests.find({
      where, order: { createdAt: 'DESC' }, relations: ['resident'],
    });
    return list.map(r => ({
      ...r,
      residentName: r.resident?.realName,
      phone: r.resident?.phone,
    }));
  }

  // 匹配候选预览（不生成预约）
  @Get('requests/:id/candidates')
  async candidates(@CurrentUser() u: JwtPayload, @Param('id') id: string) {
    const req = await this.loadRequest(id, u);
    const ranked = await this.rankCandidates(req);
    return {
      crisis: req.crisisFlag,
      candidates: ranked.slice(0, 5).map(c => ({
        counselorId: c.counselorId,
        name: c.name,
        title: c.title,
        specialties: c.specialties,
        crisisCertified: c.crisisCertified,
        score: c.score,
        reasons: c.reasons,
        slot: c.slot ? { id: c.slot.id, label: c.slotLabel } : null,
      })),
    };
  }

  // 平台根据资质/时段/主题/危机等级生成预约
  @Post('requests/:id/match')
  async match(@CurrentUser() u: JwtPayload, @Param('id') id: string) {
    const req = await this.loadRequest(id, u);
    if (['converted', 'cancelled', 'crisis_handled'].includes(req.status)) {
      throw new BadRequestException('该申请已处理，不能重复匹配');
    }
    const ranked = await this.rankCandidates(req);
    if (!ranked.length || !ranked[0].slot) {
      return {
        ok: false,
        message: req.crisisFlag
          ? '当前无具危机干预资质且有空档的咨询师，请管理员人工介入（可转介市精神卫生中心）'
          : '暂无匹配的咨询师/可用时段，请稍后再试或由管理员排班',
      };
    }
    const best = ranked[0];
    const slot = best.slot;

    const appt = await this.appointments.save(this.appointments.create({
      requestId: req.id,
      residentId: req.residentId,
      counselorId: best.counselorId,
      slotId: slot.id,
      scheduledAt: new Date(`${slot.date}T${slot.startTime}:00`),
      crisisLevel: req.crisisFlag ? (req.urgency === 'crisis' ? 'crisis' : 'high') : req.urgency,
      status: 'pending',
    }));
    slot.status = 'booked'; slot.appointmentId = appt.id;
    await this.slots.save(slot);
    req.status = 'matched'; req.matchedCounselorId = best.counselorId;
    await this.requests.save(req);

    await this.chain.log({
      appointmentId: appt.id, requestId: req.id, actorName: '系统', type: 'match',
      detail: `智能匹配：${best.name}（${best.reasons.join('；')}），时段 ${best.slotLabel}`,
      crisisRelated: req.crisisFlag,
    });
    return { ok: true, appointmentId: appt.id };
  }

  // ---------- 居民档案：一条服务链时间线 ----------
  @Get('archive')
  @Roles('resident')
  async myArchive(@CurrentUser() u: JwtPayload) {
    const requests = await this.requests.find({
      where: { residentId: u.sub }, order: { createdAt: 'DESC' },
    });
    const appts = await this.appointments.find({
      where: { residentId: u.sub }, order: { scheduledAt: 'DESC' },
      relations: ['counselor'],
    });
    const result = [];
    for (const a of appts) {
      const [events, records, ratings] = await Promise.all([
        this.chain.timeline(a.id),
        this.records.find({ where: { appointmentId: a.id }, order: { createdAt: 'ASC' } }),
        this.ratings.find({ where: { appointmentId: a.id } }),
      ]);
      // 居民视角：记录仅见主题与下次计划，干预细节受权限保护
      result.push({
        appointment: {
          id: a.id, status: a.status, scheduledAt: a.scheduledAt, crisisLevel: a.crisisLevel,
          location: a.location, mode: a.mode, statusReason: a.statusReason,
          counselorName: a.counselor?.realName,
        },
        records: records.map(r => ({
          id: r.id, topic: r.topic, nextPlan: r.nextPlan,
          nextAppointmentAt: r.nextAppointmentAt, createdAt: r.createdAt,
        })),
        rated: ratings.length > 0,
        rating: ratings[0] || null,
        timeline: events,
      });
    }
    return { requests, appointments: result };
  }

  // 居民查看本人记录的脱敏视图
  @Get('appointments/:id/record-view')
  async recordView(@CurrentUser() u: JwtPayload, @Param('id') id: string) {
    const a = await this.appointments.findOne({ where: { id } });
    if (!a) throw new NotFoundException();
    if (u.role === 'resident' && a.residentId !== u.sub) throw new BadRequestException('无权查看他人记录');
    const records = await this.records.find({ where: { appointmentId: id }, order: { createdAt: 'ASC' } });
    return records.map(r => ({
      id: r.id, topic: r.topic, nextPlan: r.nextPlan,
      nextAppointmentAt: r.nextAppointmentAt, createdAt: r.createdAt,
    }));
  }

  @Post('appointments/:id/rating')
  @Roles('resident')
  async rate(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() dto: RatingDto) {
    const a = await this.appointments.findOne({ where: { id } });
    if (!a || a.residentId !== u.sub) throw new BadRequestException('预约不存在');
    if (a.status !== 'completed') throw new BadRequestException('仅已完成的咨询可评价');
    if (dto.score < 1 || dto.score > 5) throw new BadRequestException('评分需在1-5之间');
    const exist = await this.ratings.findOne({ where: { appointmentId: id } });
    if (exist) throw new BadRequestException('已评价过');
    await this.ratings.save(this.ratings.create({
      appointmentId: id, residentId: u.sub, score: dto.score, comment: dto.comment || '',
    }));
    await this.chain.log({
      appointmentId: id, actorId: u.sub, actorName: u.realName,
      type: 'rating', detail: `服务评价：${dto.score}星${dto.comment ? '｜' + dto.comment : ''}`,
    });
    return { ok: true };
  }

  // 家属要求查看记录 → 进入审批链（默认拒绝直接访问）
  @Post('appointments/:id/family-access')
  async familyAccess(
    @CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() dto: FamilyAccessDto,
  ) {
    const a = await this.appointments.findOne({ where: { id } });
    if (!a) throw new NotFoundException();
    if (u.role === 'resident' && a.residentId !== u.sub) throw new BadRequestException('无权操作');
    if (!dto.applicantName || !dto.reason) throw new BadRequestException('家属姓名与申请理由必填');
    const saved = await this.family.save(this.family.create({
      appointmentId: id, applicantName: dto.applicantName, relation: dto.relation || '家属',
      contact: dto.contact || '', reason: dto.reason,
    }));
    await this.chain.log({
      appointmentId: id, actorId: u.sub, actorName: u.realName, type: 'family_request',
      detail: `家属 ${dto.applicantName}（${dto.relation}）申请查看咨询记录，待管理者审批`,
    });
    return { ok: true, id: saved.id };
  }

  // ---------- 匹配算法 ----------
  private async rankCandidates(req: BookingRequest) {
    const profiles = await this.profiles.find({
      where: { active: true }, relations: ['user'],
    });
    const eligible = profiles.filter(p => {
      if (!p.user?.active) return false;
      // 危机等级 → 必须危机干预资质
      if (req.crisisFlag && !p.crisisCertified) return false;
      return true;
    });

    const today = new Date().toISOString().slice(0, 10);
    const ranked = [];
    for (const p of eligible) {
      let score = 0;
      const reasons: string[] = [];
      if ((p.specialties || []).includes(req.topicCategory)) {
        score += 5; reasons.push(`擅长「${req.topicCategory}」`);
      }
      if ((p.specialties || []).some(s => req.topic.includes(s))) {
        score += 2; reasons.push('主题关键词匹配');
      }
      if (req.crisisFlag && p.crisisCertified) {
        score += 8; reasons.push('具危机干预资质');
      }
      score += Math.min(p.yearsExperience, 10) * 0.3;

      // 未来两周负载越低越优先
      const upcoming = await this.appointments.count({
        where: { counselorId: p.userId, scheduledAt: MoreThan(new Date()) },
      });
      score -= upcoming * 0.5;

      // 可用时段：优先落在居民可约时间内
      const slots = await this.slots.find({
        where: { counselorId: p.userId, status: 'available' },
        order: { date: 'ASC', startTime: 'ASC' },
      });
      let chosen = null; let chosenLabel = '';
      const pref = (req.preferredTimes || []).map(t => t.replace(' ', 'T').slice(0, 16));
      const timeOnly = pref.filter(t => t.length <= 5); // 仅 HH:mm
      const fullDt = pref.filter(t => t.length > 5);
      for (const s of slots) {
        if (s.date < today) continue;
        const label = `${s.date} ${s.startTime}`;
        const iso = `${s.date}T${s.startTime}`;
        const hitFull = fullDt.some(t => iso.startsWith(t) || t.startsWith(iso));
        const hitTime = timeOnly.some(t => s.startTime === t);
        if (hitFull || hitTime) {
          chosen = s; chosenLabel = label; score += 4;
          reasons.push(`时段符合居民可约时间（${label}）`);
          break;
        }
      }
      if (!chosen) {
        chosen = slots.find(s => s.date >= today) || null;
        if (chosen) chosenLabel = `${chosen.date} ${chosen.startTime}`;
      }
      ranked.push({
        counselorId: p.userId, name: p.user.realName, title: p.title,
        specialties: p.specialties || [], crisisCertified: p.crisisCertified,
        score: Math.round(score * 10) / 10, reasons, slot: chosen, slotLabel: chosenLabel,
      });
    }
    return ranked.sort((a, b) => b.score - a.score);
  }

  private async loadRequest(id: string, u: JwtPayload): Promise<BookingRequest> {
    const req = await this.requests.findOne({ where: { id }, relations: ['resident'] });
    if (!req) throw new NotFoundException('申请不存在');
    if (u.role === 'resident' && req.residentId !== u.sub) {
      throw new BadRequestException('无权操作他人申请');
    }
    return req;
  }

  private async getRequestDetail(id: string, u: JwtPayload) {
    return this.loadRequest(id, u);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([
    User, CounselorProfile, AvailabilitySlot, BookingRequest, Appointment,
    ConsultationRecord, ServiceRating, FamilyAccessRequest,
  ]), ChainModule],
  controllers: [ResidentController],
})
export class ResidentModule {}
