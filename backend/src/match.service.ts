import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { BookingRequest, CounselorProfile, AvailabilitySlot, Appointment } from './entities';

export interface RankedCandidate {
  counselorId: string;
  name: string;
  title: string;
  specialties: string[];
  crisisCertified: boolean;
  score: number;
  reasons: string[];
  slot: AvailabilitySlot | null;
  slotLabel: string;
}

// 匹配算法：资质（危机强制）> 主题专长 > 可约时间 > 资历/负载
@Injectable()
export class MatchService {
  constructor(
    @InjectRepository(CounselorProfile) private profiles: Repository<CounselorProfile>,
    @InjectRepository(AvailabilitySlot) private slots: Repository<AvailabilitySlot>,
    @InjectRepository(Appointment) private appointments: Repository<Appointment>,
  ) {}

  async rankCandidates(req: BookingRequest): Promise<RankedCandidate[]> {
    const profiles = await this.profiles.find({
      where: { active: true }, relations: ['user'],
    });
    const eligible = profiles.filter(p => {
      if (!p.user?.active) return false;
      if (req.crisisFlag && !p.crisisCertified) return false;
      return true;
    });

    const today = new Date().toISOString().slice(0, 10);
    const ranked: RankedCandidate[] = [];
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

      const upcoming = await this.appointments.count({
        where: { counselorId: p.userId, scheduledAt: MoreThan(new Date()) },
      });
      score -= upcoming * 0.5;

      const slots = await this.slots.find({
        where: { counselorId: p.userId, status: 'available' },
        order: { date: 'ASC', startTime: 'ASC' },
      });
      let chosen: AvailabilitySlot | null = null;
      let chosenLabel = '';
      const pref = (req.preferredTimes || []).map(t => t.replace(' ', 'T').slice(0, 16));
      const timeOnly = pref.filter(t => t.length <= 5);
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
}
