import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServiceChainEvent } from './entities';
import { ChainService } from './chain.service';

@Module({
  imports: [TypeOrmModule.forFeature([ServiceChainEvent])],
  providers: [ChainService],
  exports: [ChainService, TypeOrmModule],
})
export class ChainModule {}
