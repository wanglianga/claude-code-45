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
  HighRiskTriage, CrisisEvent,
} from './entities';
import { AuthGuard, CurrentUser, JwtPayload, Roles } from './auth.guard';
import { ChainModule } from './chain.module';
import { ChainService } from './chain.service';
import { MatchModule } from './match.module';
import { MatchService } from './match.service';
import { detectSelfHarmKeywords } from './triage.util';

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
  emergencyContactName?: string;
  emergencyContactRelation?: string;
  emergencyContactPhone?: string;
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
    @InjectRepository(HighRiskTriage) private triages: Repository<HighRiskTriage>,
    @InjectRepository(CrisisEvent) private crises: Repository<CrisisEvent>,
    private chain: ChainService,
    private matcher: MatchService,
  ) {}

  // ---------- 预约申请 ----------
  @Post('requests')
  @Roles('resident')
  async createRequest(@CurrentUser() u: JwtPayload, @Body() dto: CreateRequestDto) {
    if (!dto.confidentialityAuthorized) {
      throw new BadRequestException('需先签署保密授权才能提交预约');
    }
    if (!dto.topic || dto.age == null) throw new BadRequestException('主题与年龄必填');

    // 自伤风险关键词即时识别（主题 + 既往咨询文本）
    const keywords = detectSelfHarmKeywords(dto.topic, dto.priorCounseling || '');
    const crisisByForm =
      CRISIS_URGENCIES.includes(dto.urgency) ||
      ['plan', 'recent_act'].includes(dto.selfHarmRisk);
    // 命中关键词即视为高危，即使居民选择的紧急程度较低
    const crisis = crisisByForm || keywords.length > 0;

    const req = await this.requests.save(this.requests.create({
      residentId: u.sub,
      topicCategory: dto.topicCategory,
      topic: dto.topic,
      age: dto.age,
      urgency: keywords.length > 0 && dto.urgency === 'low' ? 'high' : dto.urgency,
      selfHarmRisk: dto.selfHarmRisk,
      priorCounseling: dto.priorCounseling || '',
      preferredTimes: dto.preferredTimes || [],
      confidentialityAuthorized: true,
      crisisFlag: crisis,
      triageKeywords: keywords,
      emergencyContactName: dto.emergencyContactName || '',
      emergencyContactRelation: dto.emergencyContactRelation || '',
      emergencyContactPhone: dto.emergencyContactPhone || '',
    }));
    await this.chain.log({
      requestId: req.id, actorId: u.sub, actorName: u.realName,
      type: 'request',
      detail: `提交预约申请：${dto.topicCategory}｜紧急程度=${req.urgency}｜自伤风险=${dto.selfHarmRisk}` +
        (dto.emergencyContactName ? `｜紧急联系人=${dto.emergencyContactName}(${dto.emergencyContactRelation})` : ''),
      crisisRelated: crisis,
    });

    // 高危即时分流：仅当文本命中自伤风险关键词时触发，跳过普通排班。
    // 表单显式填写的高危机等级（无关键词）仍走原有“危机资质匹配 + 社工初筛”通道。
    if (keywords.length > 0) {
      const triage = await this.triages.save(this.triages.create({
        requestId: req.id, residentId: u.sub,
        socialWorkerId: null, socialWorkerName: '',
        visitReason: dto.topic,
        scaleResult: '', scaleScore: null,
        emergencyContactName: dto.emergencyContactName || '',
        emergencyContactRelation: dto.emergencyContactRelation || '',
        emergencyContactPhone: dto.emergencyContactPhone || '',
        riskLevel: req.urgency === 'crisis' ? 'crisis' : 'high',
        status: 'in_progress',
      }));
      req.status = 'triage';
      await this.requests.save(req);

      await this.chain.log({
        requestId: req.id, actorName: '系统', type: 'crisis_flag',
        detail: keywords.length
          ? `高危即时分流：文本命中自伤风险关键词（${keywords.join('、')}），跳过普通排班，转社工电话核实/联系紧急联系人/评估转介`
          : '高危即时分流：危机等级申请跳过普通排班，转社工即时处置',
        crisisRelated: true,
      });
      // 自动开立危机事件，等待社工响应（紧急联系人响应后续写入同一事件）
      const ce = await this.crises.save(this.crises.create({
        requestId: req.id, residentId: u.sub, reporterId: null,
        level: dto.selfHarmRisk === 'none' ? 'ideation' : dto.selfHarmRisk,
        description: `平台自动识别高危预约：${dto.topic}` +
          (keywords.length ? `（命中关键词：${keywords.join('、')}）` : ''),
        actionTaken: dto.emergencyContactName
          ? `待社工联系紧急联系人 ${dto.emergencyContactName}（${dto.emergencyContactRelation}）${dto.emergencyContactPhone}`
          : '居民未填写紧急联系人，社工需优先电话核实并补录',
        status: 'open',
      }));
      triage.actionNote = `危机事件 ${ce.id.slice(0, 8)} 已自动开立`;
      await this.triages.save(triage);

      return {
        ok: true, triage: true,
        request: req,
        keywords,
        message: keywords.length
          ? `检测到自伤风险关键词（${keywords.join('、')}），已跳过普通排班并通知社工即时分流：电话核实、联系紧急联系人或转介医院`
          : '该申请为高危个案，已进入社工即时分流通道',
      };
    }

    return { ok: true, triage: false, request: req };
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
    if (req.status === 'triage') {
      throw new ForbiddenException('该高危申请正在社工即时分流，暂不进入普通排班');
    }
    const ranked = await this.matcher.rankCandidates(req);
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
    if (req.status === 'triage') {
      throw new ForbiddenException('高危申请须先由社工完成即时分流（电话核实/联系紧急联系人/转介医院），不能直接排班');
    }
    if (['converted', 'cancelled', 'crisis_handled'].includes(req.status)) {
      throw new BadRequestException('该申请已处理，不能重复匹配');
    }
    const ranked = await this.matcher.rankCandidates(req);
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

  private async loadRequest(id: string, u: JwtPayload): Promise<BookingRequest> {
    const req = await this.requests.findOne({ where: { id }, relations: ['resident'] });
    if (!req) throw new NotFoundException('申请不存在');
    if (u.role === 'resident' && req.residentId !== u.sub) {
      throw new BadRequestException('无权操作他人申请');
    }
    return req;
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([
    User, CounselorProfile, AvailabilitySlot, BookingRequest, Appointment,
    ConsultationRecord, ServiceRating, FamilyAccessRequest,
    HighRiskTriage, CrisisEvent,
  ]), ChainModule, MatchModule],
  controllers: [ResidentController],
})
export class ResidentModule {}
