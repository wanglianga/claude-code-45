import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Controller, Get, Post, Body, Param, Query, UseGuards, BadRequestException, NotFoundException,
} from '@nestjs/common';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import {
  User, CounselorProfile, AvailabilitySlot, BookingRequest, Appointment, Screening,
  ConsultationRecord, Referral, CrisisEvent, FollowUp, ServiceRating,
  FamilyAccessRequest, LeaveRequest,
} from './entities';
import { AuthGuard, CurrentUser, JwtPayload, Roles } from './auth.guard';
import { ChainModule } from './chain.module';
import { ChainService } from './chain.service';

@Controller('admin')
@UseGuards(AuthGuard)
@Roles('admin')
export class AdminController {
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
    private chain: ChainService,
  ) {}

  // ---------- 人员与咨询师资源 ----------
  @Get('team')
  async team() {
    const [counselors, workers] = await Promise.all([
      this.users.find({ where: { role: 'counselor' }, relations: ['counselorProfile'] }),
      this.users.find({ where: { role: 'social_worker' } }),
    ]);
    const counselorRows = [];
    for (const c of counselors) {
      const [booked, future] = await Promise.all([
        this.slots.count({ where: { counselorId: c.id, status: 'booked' } }),
        this.appointments.count(), // 全局基数在下面用
      ]);
      const load = await this.appointments
        .createQueryBuilder('a')
        .where('a.counselorId = :id', { id: c.id })
        .andWhere("a.status IN ('confirmed','in_progress','completed','no_show','referred')")
        .getCount();
      const crisisLoad = await this.appointments.count({
        where: { counselorId: c.id, crisisLevel: 'crisis' },
      });
      counselorRows.push({
        id: c.id, name: c.realName, active: c.active,
        title: c.counselorProfile?.title,
        specialties: c.counselorProfile?.specialties || [],
        crisisCertified: !!c.counselorProfile?.crisisCertified,
        yearsExperience: c.counselorProfile?.yearsExperience || 0,
        totalCases: load, crisisCases: crisisLoad, bookedSlots: booked,
      });
    }
    return {
      counselors: counselorRows,
      socialWorkers: workers.map(w => ({ id: w.id, name: w.realName, phone: w.phone })),
    };
  }

  // ---------- 家属查看记录审批 ----------
  @Get('family-requests')
  listFamily(@Query('status') status?: string) {
    const where: any = {};
    if (status) where.status = status;
    return this.family.find({ where, order: { createdAt: 'DESC' } });
  }

  @Post('family-requests/:id/review')
  async reviewFamily(
    @CurrentUser() u: JwtPayload, @Param('id') id: string,
    @Body() body: { approve: boolean; note?: string },
  ) {
    const f = await this.family.findOne({ where: { id } });
    if (!f) throw new NotFoundException();
    f.status = body.approve ? 'approved' : 'rejected';
    f.reviewedById = u.sub;
    f.reviewNote = body.note || '';
    if (body.approve) {
      f.approvedAt = new Date();
      // 一次性、72 小时有效的保密例外授权
      f.expiresAt = new Date(Date.now() + 72 * 3600 * 1000);
    }
    await this.family.save(f);
    await this.chain.log({
      appointmentId: f.appointmentId, actorId: u.sub, actorName: u.realName,
      type: 'family_review',
      detail: body.approve
        ? `批准家属 ${f.applicantName} 在72小时内查看记录（保密例外，一次性授权）`
        : `驳回家属 ${f.applicantName} 的查看申请：${body.note || '依据保密原则'}`,
    });
    return { ok: true };
  }

  // 审批通过后，凭批准单仅可一次性查看脱敏摘要
  @Get('family-requests/:id/record')
  async familyRecord(
    @CurrentUser() u: JwtPayload, @Param('id') id: string,
  ) {
    const f = await this.family.findOne({ where: { id } });
    if (!f) throw new NotFoundException();
    // 每次访问尝试都留痕；重复查看一律拒绝，杜绝授权窗口内反复调阅
    if (f.status === 'approved' && !f.viewedAt) {
      if (f.expiresAt && f.expiresAt.getTime() < Date.now()) {
        await this.chain.log({
          appointmentId: f.appointmentId, actorId: u.sub, actorName: u.realName,
          type: 'family_view_denied',
          detail: `家属 ${f.applicantName} 的授权已过期，查看脱敏摘要被拒绝`,
        });
        throw new BadRequestException('授权已过期（72小时一次性授权）');
      }
      const records = await this.records.find({
        where: { appointmentId: f.appointmentId }, order: { createdAt: 'ASC' },
      });
      // 首次也是唯一一次成功查看：立即标记 consumed，之后再请求即拒绝
      f.viewedAt = new Date();
      await this.family.save(f);
      await this.chain.log({
        appointmentId: f.appointmentId, actorId: u.sub, actorName: u.realName,
        type: 'family_view',
        detail: `家属 ${f.applicantName}（${f.relation}）查看脱敏风险摘要：${records.length} 条记录（一次性授权已使用）`,
      });
      // 最小必要原则：仅返回风险评估与干预建议摘要，不含咨询过程原文
      return records.map(r => ({
        id: r.id, topic: r.topic, riskLevel: r.riskLevel,
        riskAssessment: r.riskAssessment, interventionAdvice: r.interventionAdvice, createdAt: r.createdAt,
      }));
    }
    // 未批准 / 已使用 / 已过期 → 拒绝并记录
    const reason = f.status !== 'approved'
      ? '申请未获批准'
      : '一次性授权已使用（摘要已查看过，再次查看被拒绝）';
    await this.chain.log({
      appointmentId: f.appointmentId, actorId: u.sub, actorName: u.realName,
      type: 'family_view_denied',
      detail: `家属 ${f.applicantName} 再次/非法查看脱敏摘要被拒绝：${reason}`,
    });
    throw new BadRequestException(reason);
  }

  // ---------- 咨询师请假审批 + 受影响预约改约 ----------
  @Get('leave-requests')
  listLeave(@Query('status') status?: string) {
    return this.leaves.find({ where: status ? { status: status as any } : {} as any, order: { createdAt: 'DESC' } });
  }

  @Post('leave-requests/:id/review')
  async reviewLeave(
    @CurrentUser() u: JwtPayload, @Param('id') id: string,
    @Body() body: { approve: boolean; note?: string },
  ) {
    const leave = await this.leaves.findOne({ where: { id } });
    if (!leave) throw new NotFoundException();
    if (leave.status !== 'pending') throw new BadRequestException('已审批');
    leave.status = body.approve ? 'approved' : 'rejected';
    leave.reviewedById = u.sub;
    await this.leaves.save(leave);

    const counselor = await this.users.findOne({ where: { id: leave.counselorId } });
    const cname = counselor?.realName || '咨询师';

    if (!body.approve) {
      return { ok: true, rescheduled: 0, stranded: 0 };
    }

    // 冻结请假区间内空闲时段
    const openSlots = await this.slots
      .createQueryBuilder('s')
      .where('s.counselorId = :cid', { cid: leave.counselorId })
      .andWhere('s.date BETWEEN :a AND :b', { a: leave.startDate, b: leave.endDate })
      .andWhere("s.status = 'available'")
      .getMany();
    for (const s of openSlots) { s.status = 'blocked'; await this.slots.save(s); }

    // 受影响的已排预约：释放原时段并尝试改约
    const affected = await this.appointments
      .createQueryBuilder('a')
      .where('a.counselorId = :cid', { cid: leave.counselorId })
      .andWhere(`(a.scheduled_at::date BETWEEN :a AND :b)`, { a: leave.startDate, b: leave.endDate })
      .andWhere("a.status IN ('pending','confirmed','in_progress')")
      .getMany();

    let rescheduled = 0; let stranded = 0;
    for (const a of affected) {
      if (a.slotId) {
        const old = await this.slots.findOne({ where: { id: a.slotId } });
        if (old) { old.status = 'blocked'; old.appointmentId = null; await this.slots.save(old); }
      }
      const alt = await this.findAlternativeCounselor(a);
      if (alt) {
        a.counselorId = alt.counselorId;
        a.slotId = alt.slot.id;
        a.scheduledAt = new Date(`${alt.slot.date}T${alt.slot.startTime}:00`);
        a.status = 'pending';
        a.statusReason = `原咨询师${cname}请假（${leave.startDate}~${leave.endDate}），系统改约`;
        alt.slot.status = 'booked'; alt.slot.appointmentId = a.id;
        await this.slots.save(alt.slot);
        await this.appointments.save(a);
        rescheduled++;
        await this.chain.log({
          appointmentId: a.id, actorId: u.sub, actorName: u.realName, type: 'leave_reschedule',
          detail: `咨询师请假，自动改约至 ${alt.name}（${alt.slot.date} ${alt.slot.startTime}），需重新初筛确认`,
          crisisRelated: ['high', 'crisis'].includes(a.crisisLevel),
        });
      } else {
        a.status = 'leave_rescheduled';
        a.statusReason = `咨询师${cname}请假，暂无替代资源，待管理员排班`;
        await this.appointments.save(a);
        stranded++;
        await this.chain.log({
          appointmentId: a.id, actorId: u.sub, actorName: u.realName, type: 'leave_stranded',
          detail: `咨询师请假且无替代资源，预约挂起待人工排班`,
          crisisRelated: ['high', 'crisis'].includes(a.crisisLevel),
        });
      }
    }
    return { ok: true, rescheduled, stranded };
  }

  // 改约辅助：同资质（危机单须危机资质）+ 主题匹配优先 + 未来最早空档
  private async findAlternativeCounselor(a: Appointment) {
    const profiles = await this.profiles.find({
      where: { active: true }, relations: ['user'],
    });
    const req = a.requestId
      ? await this.requests.findOne({ where: { id: a.requestId } })
      : null;
    const today = new Date().toISOString().slice(0, 10);
    const candidates = [];
    for (const p of profiles) {
      if (p.userId === a.counselorId || !p.user?.active) continue;
      if (['high', 'crisis'].includes(a.crisisLevel) && !p.crisisCertified) continue;
      const slot = await this.slots.findOne({
        where: { counselorId: p.userId, status: 'available' },
        order: { date: 'ASC', startTime: 'ASC' },
      });
      if (!slot || slot.date < today) continue;
      let score = 0;
      if (req && (p.specialties || []).includes(req.topicCategory)) score += 5;
      if (p.crisisCertified) score += 2;
      candidates.push({ score, counselorId: p.userId, name: p.user.realName, slot });
    }
    candidates.sort((x, y) =>
      y.score - x.score || x.slot.date.localeCompare(y.slot.date) || x.slot.startTime.localeCompare(y.slot.startTime));
    return candidates[0] || null;
  }

  // ---------- 转介回执（转介结果回流，影响供给评估） ----------
  @Get('referrals')
  listReferrals(@Query('status') status?: string) {
    return this.referrals.find({
      where: (status ? { status: status as any } : {}) as any, order: { createdAt: 'DESC' },
    });
  }

  @Post('referrals/:id/receipt')
  async receipt(
    @CurrentUser() u: JwtPayload, @Param('id') id: string,
    @Body() body: { outcome: 'accepted' | 'hospitalized' | 'outpatient' | 'declined'; receiptText: string },
  ) {
    const r = await this.referrals.findOne({ where: { id } });
    if (!r) throw new NotFoundException();
    if (!body.receiptText) throw new BadRequestException('请填写医院回执内容');
    r.status = 'receipt_received';
    r.outcome = body.outcome;
    r.receiptText = body.receiptText;
    r.receiptAt = new Date();
    await this.referrals.save(r);
    await this.chain.log({
      appointmentId: r.appointmentId, actorId: u.sub, actorName: u.realName, type: 'receipt',
      detail: `转介回执：结果=${body.outcome}｜${body.receiptText}`, crisisRelated: true,
    });
    return { ok: true };
  }

  // ---------- 危机事件总览 ----------
  @Get('crisis')
  async crisisBoard() {
    const [open, resolved, list] = await Promise.all([
      this.crises.count({ where: { status: 'open' } }),
      this.crises.count({ where: { status: 'resolved' } }),
      this.crises.find({ order: { createdAt: 'DESC' }, take: 50 }),
    ]);
    return { open, resolved, list };
  }

  // ---------- 数据看板：服务量 / 风险等级 / 转介结果 → 供给决策 ----------
  @Get('stats')
  async stats() {
    const [
      totalAppts, completed, noShow, referred, pending,
      crisisAppts, highAppts, totalRequests, crisisRequests, unmatched,
      totalCounselors, certifiedCounselors, totalWorkers,
      crisisOpen, crisisResolved, avgRatingRaw,
    ] = await Promise.all([
      this.appointments.count(),
      this.appointments.count({ where: { status: 'completed' } }),
      this.appointments.count({ where: { status: 'no_show' } }),
      this.appointments.count({ where: { status: 'referred' } }),
      this.appointments.count({ where: { status: 'pending' } }),
      this.appointments.count({ where: { crisisLevel: 'crisis' } }),
      this.appointments.count({ where: { crisisLevel: 'high' } }),
      this.requests.count(),
      this.requests.count({ where: { crisisFlag: true } }),
      this.requests.count({ where: { status: 'submitted' } }),
      this.users.count({ where: { role: 'counselor', active: true } }),
      this.profiles.count({ where: { crisisCertified: true, active: true } }),
      this.users.count({ where: { role: 'social_worker', active: true } }),
      this.crises.count({ where: { status: 'open' } }),
      this.crises.count({ where: { status: 'resolved' } }),
      this.ratings.createQueryBuilder('r').select('AVG(r.score)', 'avg').getRawOne(),
    ]);

    // 按月服务量
    const monthly = await this.appointments
      .createQueryBuilder('a')
      .select(`to_char(a.scheduledAt, 'YYYY-MM')`, 'month')
      .addSelect('COUNT(*)', 'count')
      .groupBy('month').orderBy('month', 'DESC').limit(6).getRawMany();

    // 风险等级分布（预约）
    const riskRows = await this.appointments
      .createQueryBuilder('a')
      .select('a.crisisLevel', 'level').addSelect('COUNT(*)', 'count')
      .groupBy('a.crisisLevel').getRawMany();

    // 转介结果分布
    const referralRows = await this.referrals
      .createQueryBuilder('r')
      .select('COALESCE(r.outcome, r.status)', 'result').addSelect('COUNT(*)', 'count')
      .groupBy('result').getRawMany();

    // 初筛决策分布
    const screenRows = await this.screenings
      .createQueryBuilder('s')
      .select('s.decision', 'decision').addSelect('COUNT(*)', 'count')
      .groupBy('s.decision').getRawMany();

    // 每位咨询师负载与利用率
    const counselorLoad = await this.appointments
      .createQueryBuilder('a')
      .select('a.counselorId', 'counselorId')
      .addSelect('COUNT(*)', 'cases')
      .addSelect(`SUM(CASE WHEN a.crisisLevel IN ('high','crisis') THEN 1 ELSE 0 END)`, 'crisisCases')
      .groupBy('a.counselorId').getRawMany();
    const names = new Map((await this.users.find({ where: { role: 'counselor' } })).map(u => [u.id, u.realName]));
    const loadBoard = counselorLoad.map(l => ({
      counselorId: l.counselorId, name: names.get(l.counselorId) || l.counselorId,
      cases: Number(l.cases), crisisCases: Number(l.crisisCases),
    })).sort((a, b) => b.cases - a.cases);

    // ---------- 供给决策建议引擎 ----------
    const recommendations: { level: 'warning' | 'critical' | 'info'; type: string; text: string }[] = [];
    const crisisShare = totalAppts ? (crisisAppts + highAppts) / totalAppts : 0;
    const referRate = totalAppts ? referred / totalAppts : 0;
    const avgLoad = totalCounselors ? loadBoard.reduce((s, l) => s + l.cases, 0) / totalCounselors : 0;

    if (unmatched > 0) {
      recommendations.push({
        level: 'critical', type: 'capacity',
        text: `有 ${unmatched} 份预约申请尚未匹配到咨询师，建议增加咨询师排班或人手`,
      });
    }
    if (totalCounselors > 0 && avgLoad > 12) {
      recommendations.push({
        level: 'warning', type: 'capacity',
        text: `咨询师人均在管 ${avgLoad.toFixed(1)} 个案例，负载偏高，建议增配咨询师`,
      });
    }
    if (crisisShare >= 0.25 || crisisRequests >= 3) {
      recommendations.push({
        level: certifiedCounselors < 2 ? 'critical' : 'warning', type: 'training',
        text: `高风险/危机案例占比 ${(crisisShare * 100).toFixed(0)}%（危机申请 ${crisisRequests} 份），` +
          `当前仅 ${certifiedCounselors} 名危机干预资质咨询师，建议开展社工危机识别培训并扩充资质人员`,
      });
    }
    if (referRate >= 0.2) {
      recommendations.push({
        level: 'warning', type: 'hospital',
        text: `转介率 ${(referRate * 100).toFixed(0)}%，社区与精神专科衔接压力大，建议深化与市精神卫生中心的绿色通道/会诊合作`,
      });
    }
    const declined = referralRows.find(r => r.result === 'declined');
    if (declined) {
      recommendations.push({
        level: 'warning', type: 'hospital',
        text: `有 ${declined.count} 例转介被医院退回/拒收，需复盘转介标准并加强医院合作机制`,
      });
    }
    if (noShow >= 3) {
      recommendations.push({
        level: 'info', type: 'followup',
        text: `累计爽约 ${noShow} 例，建议强化预约提醒与爽约后电话随访（风险案例优先）`,
      });
    }
    if (!recommendations.length) {
      recommendations.push({ level: 'info', type: 'ok', text: '当前服务供给与风险响应总体平稳，继续保持月度复盘' });
    }

    return {
      volume: {
        totalRequests, totalAppts, completed, noShow, referred, pending,
        avgRating: avgRatingRaw?.avg ? Number(Number(avgRatingRaw.avg).toFixed(2)) : null,
      },
      monthly: monthly.map(m => ({ month: m.month, count: Number(m.count) })),
      riskDistribution: {
        crisis: crisisAppts, high: highAppts,
        medium: Number(riskRows.find(r => r.level === 'medium')?.count || 0),
        low: Number(riskRows.find(r => r.level === 'low')?.count || 0),
      },
      referralResults: referralRows.map(r => ({ result: r.result, count: Number(r.count) })),
      screeningDecisions: screenRows.map(r => ({ decision: r.decision, count: Number(r.count) })),
      crisis: { open: crisisOpen, resolved: crisisResolved, crisisRequests },
      supply: { totalCounselors, certifiedCounselors, totalWorkers, avgLoad: Number(avgLoad.toFixed(1)) },
      counselorLoad: loadBoard,
      recommendations,
    };
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([
    User, CounselorProfile, AvailabilitySlot, BookingRequest, Appointment, Screening,
    ConsultationRecord, Referral, CrisisEvent, FollowUp, ServiceRating,
    FamilyAccessRequest, LeaveRequest,
  ]), ChainModule],
  controllers: [AdminController],
})
export class AdminModule {}
