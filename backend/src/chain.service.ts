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
}
