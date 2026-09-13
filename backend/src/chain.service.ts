import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ServiceChainEvent } from './entities';

@Injectable()
export class ChainService {
  constructor(
    @InjectRepository(ServiceChainEvent) private events: Repository<ServiceChainEvent>,
  ) {}

  async log(params: {
    appointmentId?: string | null;
    requestId?: string | null;
    actorId?: string | null;
    actorName: string;
    type: string;
    detail?: string;
    crisisRelated?: boolean;
  }) {
    const e = this.events.create({
      appointmentId: params.appointmentId ?? null,
      requestId: params.requestId ?? null,
      actorId: params.actorId ?? null,
      actorName: params.actorName,
      type: params.type,
      detail: params.detail || '',
      crisisRelated: !!params.crisisRelated,
    });
    await this.events.save(e);
    return e;
  }

  async timeline(appointmentId: string) {
    return this.events.find({
      where: { appointmentId },
      order: { createdAt: 'ASC' },
    });
  }

  // 合并申请阶段与预约阶段事件（高危分流的事件可能先挂在 requestId 上）
  async timelineFor(requestId: string | null | undefined, appointmentId: string | null | undefined) {
    if (!requestId && !appointmentId) return [];
    const where: any[] = [];
    if (requestId) where.push({ requestId });
    if (appointmentId) where.push({ appointmentId });
    return this.events.find({ where, order: { createdAt: 'ASC' } });
  }
}
